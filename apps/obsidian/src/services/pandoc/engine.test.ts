// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { type CslItemData } from "@zotlit/db";

import { yieldToMain } from "@/lib/yield-to-main";

import {
  type CitationEngine,
  CitationEngineError,
  CitationRequestSupersededError,
  createCitationEngine,
} from "./engine";

/**
 * The binary the plugin pins, read straight out of `pandoc-wasm`. The package
 * resolves through its `node` condition, so its entry sits beside `pandoc.wasm`.
 */
const WASM_PATH = join(
  dirname(createRequire(import.meta.url).resolve("pandoc-wasm")),
  "pandoc.wasm",
);

/** Instantiating the Haskell runtime dominates every timing here. */
const TIMEOUT = 60_000;

const ZETA: CslItemData = {
  id: "1/ZETA1234",
  type: "book",
  title: "A study of nothing",
  author: [{ family: "Zeta", given: "Ann" }],
  issued: { "date-parts": [[2020]] },
};
const ADAMS: CslItemData = {
  id: "2/ADAM5678",
  type: "book",
  title: "Beta and beyond",
  author: [{ family: "Adams", given: "Bob" }],
  issued: { "date-parts": [[2018]] },
};

/** The id shape `itemToCsl` builds for a personal-library item. */
const ZOTERO_URI_ID = "http://zotero.org/users/12345/items/ZETA1234";

/** A numbered style, so a rendered entry is unmistakably this style's work. */
const NUMERIC_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Numeric</title>
    <id>http://example.com/numeric</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text variable="citation-number" prefix="[" suffix="]"/></layout></citation>
  <bibliography second-field-align="flush">
    <layout>
      <text variable="citation-number" prefix="[" suffix="]"/>
      <names variable="author"><name/></names>
      <text variable="title" prefix=". " suffix="."/>
    </layout>
  </bibliography>
</style>`;

/**
 * Stand-in for the sandbox variant of `zotlit-cite.lua`: reads the pre-written
 * resolve map and turns every mapped link into a citation. Pandoc percent-encodes
 * wikilink targets, so the linkpath is decoded before the lookup.
 */
const RESOLVE_FILTER = `
local citations = nil

function Link(link)
  if citations == nil then
    local file = io.open("resolve-map.json", "r")
    citations = pandoc.json.decode(file:read("a")).citations
    file:close()
  end
  local linkpath = link.target:gsub("%%(%x%x)", function(hex)
    return string.char(tonumber(hex, 16))
  end)
  local key = citations[linkpath]
  if key == nil then return nil end
  return pandoc.Cite(
    { pandoc.Str("[@" .. key .. "]") },
    { pandoc.Citation(key, "NormalCitation") }
  )
end
`;

const RESOLVE_MAP = JSON.stringify({ citations: { "Zeta 2020": ZETA.id } });
const DOCUMENT = "Cited here [[Zeta 2020]].\n\n# References\n";

async function openEngine(): Promise<CitationEngine> {
  return createCitationEngine(await readFile(WASM_PATH));
}

describe("createCitationEngine", { timeout: TIMEOUT }, () => {
  let engine: CitationEngine;

  beforeAll(async () => {
    engine = await openEngine();
    return () => engine[Symbol.asyncDispose]();
  });

  it("renders one bibliography entry per item, keyed by CSL id", async () => {
    const entries = await engine.renderBibliography({ items: [ZETA, ADAMS] });

    expect(entries.map((entry) => entry.id).toSorted()).toEqual([
      ZETA.id,
      ADAMS.id,
    ]);
    expect(entries.find((entry) => entry.id === ZETA.id)?.html).toContain(
      "Zeta, Ann",
    );
  });

  it("formats entries with the supplied CSL style", async () => {
    const [first] = await engine.renderBibliography({
      items: [ZETA],
      styleXml: NUMERIC_STYLE,
    });

    expect(first?.id).toBe(ZETA.id);
    expect(first?.html).toContain("[1]");
    expect(first?.html).toContain("A study of nothing");
  });

  it("renders no entries for an empty item set", async () => {
    await expect(engine.renderBibliography({ items: [] })).resolves.toEqual([]);
  });

  /**
   * `itemToCsl` addresses an item by its Zotero URI, which is long enough that
   * Pandoc's default line wrapping would break the opening tag of the entry.
   */
  it("keys entries by a Zotero URI id", async () => {
    const item: CslItemData = { ...ZETA, id: ZOTERO_URI_ID };
    const entries = await engine.renderBibliography({ items: [item] });

    expect(entries.map((entry) => entry.id)).toEqual([ZOTERO_URI_ID]);
    expect(entries[0]?.html).toContain("Zeta, Ann");
  });

  it("keys entries by a Zotero URI id under a numbered style", async () => {
    const item: CslItemData = { ...ZETA, id: ZOTERO_URI_ID };
    const entries = await engine.renderBibliography({
      items: [item],
      styleXml: NUMERIC_STYLE,
    });

    expect(entries.map((entry) => entry.id)).toEqual([ZOTERO_URI_ID]);
    expect(entries[0]?.html).toContain("[1]");
  });

  it("reports the Pandoc failure for an unusable style", async () => {
    await expect(
      engine.renderBibliography({ items: [ZETA], styleXml: "<not-a-style/>" }),
    ).rejects.toThrow(CitationEngineError);
  });

  it("converts a document with a resolve map into docx bytes", async () => {
    const docx = await engine.renderDocument({
      markdown: DOCUMENT,
      format: "docx",
      bibliography: [ZETA],
      luaFilters: [RESOLVE_FILTER],
      files: { "resolve-map.json": RESOLVE_MAP },
    });

    // docx is a zip container; its local file header starts every archive.
    expect(docx.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
  });

  it("converts a document with a resolve map into cited html bytes", async () => {
    const html = await engine.renderDocument({
      markdown: DOCUMENT,
      format: "html",
      bibliography: [ZETA],
      styleXml: NUMERIC_STYLE,
      luaFilters: [RESOLVE_FILTER],
      files: { "resolve-map.json": RESOLVE_MAP },
    });

    const text = new TextDecoder().decode(html);
    expect(text).toContain(`data-cites="${ZETA.id}"`);
    expect(text).toContain(`id="ref-${ZETA.id}"`);
  });

  it("serializes concurrent requests without crossing their virtual files", async () => {
    const finished: string[] = [];
    const track = async (item: CslItemData) => {
      const entries = await engine.renderBibliography({
        items: [item],
        styleXml: NUMERIC_STYLE,
      });
      finished.push(item.id);
      return entries;
    };

    const [zeta, adams] = await Promise.all([track(ZETA), track(ADAMS)]);

    expect(zeta.map((entry) => entry.id)).toEqual([ZETA.id]);
    expect(adams.map((entry) => entry.id)).toEqual([ADAMS.id]);
    expect(finished).toEqual([ZETA.id, ADAMS.id]);
  });

  it("supersedes a waiting request when a newer one claims its slot", async () => {
    const stale = engine.renderBibliography({
      items: [ZETA],
      supersedes: "sidebar",
    });
    const newest = engine.renderBibliography({
      items: [ADAMS],
      supersedes: "sidebar",
    });

    await expect(stale).rejects.toThrow(CitationRequestSupersededError);
    await expect(newest).resolves.toEqual([
      expect.objectContaining({ id: ADAMS.id }),
    ]);
  });

  it("runs requests that claim no slot or another slot", async () => {
    const unslotted = engine.renderBibliography({ items: [ZETA] });
    const other = engine.renderBibliography({
      items: [ZETA],
      supersedes: "export",
    });
    const newest = engine.renderBibliography({
      items: [ADAMS],
      supersedes: "sidebar",
    });

    await expect(unslotted).resolves.toHaveLength(1);
    await expect(other).resolves.toHaveLength(1);
    await expect(newest).resolves.toHaveLength(1);
  });

  it("keeps the running request when a newer one claims its slot", async () => {
    const running = engine.renderBibliography({
      items: [ZETA],
      supersedes: "sidebar",
    });
    // The conversion runs synchronously, so a macrotask yield lands after it.
    await yieldToMain();
    const newest = engine.renderBibliography({
      items: [ADAMS],
      supersedes: "sidebar",
    });

    await expect(running).resolves.toEqual([
      expect.objectContaining({ id: ZETA.id }),
    ]);
    await expect(newest).resolves.toEqual([
      expect.objectContaining({ id: ADAMS.id }),
    ]);
  });
});

describe("engine disposal", { timeout: TIMEOUT }, () => {
  it("refuses requests made after the scope ends", async () => {
    let released: CitationEngine;
    {
      await using engine = await openEngine();
      released = engine;
      await expect(
        engine.renderBibliography({ items: [ZETA] }),
      ).resolves.toHaveLength(1);
    }

    await expect(
      released.renderBibliography({ items: [ZETA] }),
    ).rejects.toThrow(CitationEngineError);
  });
});
