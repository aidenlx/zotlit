// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import type { CslItemData } from "@zotlit/db";

import { yieldToMain } from "@/lib/yield-to-main";

import type { Inlines } from "./ast";
import {
  CitationEngineError,
  CitationRequestSupersededError,
  createCitationEngine,
} from "./engine";
import type { CitationEngine } from "./engine";

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

/**
 * A style that lays an entry out as several blocks: `display="block"` and
 * `display="indent"` are what put a `csl-block` and a `csl-indent` around a
 * part of an entry, which the sidebar flattens back into one flow.
 */
const BLOCK_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Blocked</title>
    <id>http://example.com/blocked</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text variable="citation-number"/></layout></citation>
  <bibliography>
    <layout>
      <names variable="author" display="block"><name/></names>
      <text variable="title" display="indent"/>
    </layout>
  </bibliography>
</style>`;

/**
 * A style that lays a block out beside a marker: a flush layout puts the rest
 * of the entry in a second column, so its blocks nest one level deeper.
 */
const NESTED_BLOCK_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Blocked and numbered</title>
    <id>http://example.com/blocked-numbered</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text variable="citation-number" prefix="[" suffix="]"/></layout></citation>
  <bibliography second-field-align="flush">
    <layout>
      <text variable="citation-number" prefix="[" suffix="]"/>
      <names variable="author"><name/></names>
      <text variable="title" display="indent"/>
    </layout>
  </bibliography>
</style>`;

/**
 * A note-class style, whose citations citeproc renders as footnotes — the case
 * no inline surface can show, and the reason the typed AST carries `Note`.
 */
const NOTE_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="note" version="1.0">
  <info>
    <title>Noted</title>
    <id>http://example.com/noted</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation>
    <layout delimiter="; ">
      <names variable="author"><name/></names>
      <text variable="title" prefix=", " suffix="."/>
    </layout>
  </citation>
  <bibliography>
    <layout>
      <names variable="author"><name/></names>
      <text variable="title" prefix=". " suffix="."/>
    </layout>
  </bibliography>
</style>`;

/**
 * A position-dependent in-text style: a work cited again reads as the
 * subsequent form, so two occurrences of one source render differently.
 */
const POSITION_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Positional</title>
    <id>http://example.com/positional</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation>
    <layout>
      <choose>
        <if position="subsequent">
          <text value="ibid."/>
        </if>
        <else>
          <names variable="author"><name form="short"/></names>
        </else>
      </choose>
    </layout>
  </citation>
  <bibliography>
    <layout><names variable="author"><name/></names></layout>
  </bibliography>
</style>`;

const RESOLVE_MAP = JSON.stringify({ citations: { "Zeta 2020": ZETA.id } });
const DOCUMENT = "Cited here [[Zeta 2020]].\n\n# References\n";

async function openEngine(): Promise<CitationEngine> {
  return createCitationEngine(await readFile(WASM_PATH));
}

/** What an inline flow reads as, which is the text a surface would show. */
function plainText(inlines: Inlines): string {
  return inlines
    .map((inline) => {
      switch (inline.t) {
        case "Str":
          return inline.c;
        case "Space":
        case "SoftBreak":
        case "LineBreak":
          return " ";
        case "Emph":
        case "Underline":
        case "Strong":
        case "Strikeout":
        case "Superscript":
        case "Subscript":
        case "SmallCaps":
          return plainText(inline.c);
        case "Quoted":
        case "Cite":
        case "Link":
        case "Image":
        case "Span":
          return plainText(inline.c[1]);
        case "Note":
          return plainText(
            inline.c.flatMap((block) =>
              block.t === "Para" || block.t === "Plain" ? block.c : [],
            ),
          );
        default:
          return "";
      }
    })
    .join("");
}

/** What a citation renders inside the `Cite` wrapper citeproc leaves around it. */
function citeInlines(content: Inlines): Inlines {
  const cite = content.find((inline) => inline.t === "Cite");
  return cite?.t === "Cite" ? cite.c[1] : [];
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
    expect(
      entries.find((entry) => entry.id === ZETA.id)?.content.textContent,
    ).toContain("Zeta, Ann");
  });

  it("formats entries with the supplied CSL style", async () => {
    const [first] = await engine.renderBibliography({
      items: [ZETA],
      styleXml: NUMERIC_STYLE,
    });

    expect(first?.id).toBe(ZETA.id);
    expect(first?.content.textContent).toContain("A study of nothing");
  });

  it("hands the entry marker over apart from the entry text", async () => {
    const [first] = await engine.renderBibliography({
      items: [ZETA],
      styleXml: NUMERIC_STYLE,
    });

    expect(first?.marker).toBe("[1]");
    expect(first?.content.textContent).not.toContain("[1]");
  });

  it("leaves the marker unset for a style that renders none", async () => {
    const entries = await engine.renderBibliography({ items: [ZETA] });

    expect(entries[0]?.marker).toBeUndefined();
  });

  it("returns entries in the style's bibliography order", async () => {
    const entries = await engine.renderBibliography({ items: [ZETA, ADAMS] });

    // The embedded style sorts by author, so Adams leads whatever order the
    // items arrived in.
    expect(entries.map((entry) => entry.id)).toEqual([ADAMS.id, ZETA.id]);
  });

  it("flattens the blocks of an entry into one inline flow", async () => {
    const [first] = await engine.renderBibliography({
      items: [ZETA],
      styleXml: BLOCK_STYLE,
    });

    expect(first?.content.textContent).toBe("Ann Zeta A study of nothing");
    expect(first?.content.querySelector("div")).toBeNull();
  });

  it("flattens the blocks a flush layout nests beside the marker", async () => {
    const [first] = await engine.renderBibliography({
      items: [ZETA],
      styleXml: NESTED_BLOCK_STYLE,
    });

    expect(first?.marker).toBe("[1]");
    expect(first?.content.textContent).toBe("Ann Zeta A study of nothing");
    expect(first?.content.querySelector("div")).toBeNull();
  });

  it("keeps the markup a style formats an entry's text with", async () => {
    const [first] = await engine.renderBibliography({ items: [ZETA] });

    // The embedded style italicizes a book title.
    expect(first?.content.querySelector("em")?.textContent).toBe(
      "A Study of Nothing",
    );
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
    expect(entries[0]?.content.textContent).toContain("Zeta, Ann");
  });

  it("keys entries by a Zotero URI id under a numbered style", async () => {
    const item: CslItemData = { ...ZETA, id: ZOTERO_URI_ID };
    const entries = await engine.renderBibliography({
      items: [item],
      styleXml: NUMERIC_STYLE,
    });

    expect(entries.map((entry) => entry.id)).toEqual([ZOTERO_URI_ID]);
    expect(entries[0]?.marker).toBe("[1]");
  });

  it("reports the Pandoc failure for an unusable style", async () => {
    await expect(
      engine.renderBibliography({ items: [ZETA], styleXml: "<not-a-style/>" }),
    ).rejects.toThrow(CitationEngineError);
  });

  it("formats one citation per source, in the order they were asked for", async () => {
    const rendered = await engine.renderCitations({
      citations: ["[@zeta20]", "@adams18"],
      items: [
        { ...ZETA, id: "zeta20" },
        { ...ADAMS, id: "adams18" },
      ],
    });

    expect(rendered).toHaveLength(2);
    expect(rendered[0]?.textContent).toContain("Zeta");
    expect(rendered[1]?.textContent).toContain("Adams");
  });

  it("keeps the prefix, locator, and author suppression of a cluster", async () => {
    const [cluster] = await engine.renderCitations({
      citations: ["[see @zeta20, p. 3; -@adams18]"],
      items: [
        { ...ZETA, id: "zeta20" },
        { ...ADAMS, id: "adams18" },
      ],
    });

    // The embedded style renders a page locator bare, so `p.` is not in it.
    expect(cluster?.textContent).toBe("(see Zeta 2020, 3; 2018)");
  });

  it("numbers citations across the whole request under a numbered style", async () => {
    const rendered = await engine.renderCitations({
      citations: ["[@zeta20]", "[@adams18]", "[@zeta20]"],
      items: [
        { ...ZETA, id: "zeta20" },
        { ...ADAMS, id: "adams18" },
      ],
      styleXml: NUMERIC_STYLE,
    });

    expect(rendered.map((citation) => citation.textContent)).toEqual([
      "[1]",
      "[2]",
      "[1]",
    ]);
  });

  it("leaves the bibliography out of a citation render", async () => {
    const [only] = await engine.renderCitations({
      citations: ["[@zeta20]"],
      items: [{ ...ZETA, id: "zeta20" }],
    });

    expect(only?.textContent).not.toContain("A study of nothing");
  });

  it("renders nothing for an empty request", async () => {
    expect(await engine.renderCitations({ citations: [], items: [] })).toEqual(
      [],
    );
  });

  it("hands the bibliography over as typed inlines, in the style's order", async () => {
    const entries = await engine.renderBibliographyAst({
      items: [ZETA, ADAMS],
    });

    expect(entries.map((entry) => entry.id)).toEqual([ADAMS.id, ZETA.id]);
    expect(plainText(entries.at(1)?.content ?? [])).toContain("Zeta, Ann");
  });

  it("keys typed entries by a Zotero URI id", async () => {
    const entries = await engine.renderBibliographyAst({
      items: [{ ...ZETA, id: ZOTERO_URI_ID }],
      styleXml: NUMERIC_STYLE,
    });

    expect(entries.map((entry) => entry.id)).toEqual([ZOTERO_URI_ID]);
  });

  it("splits the entry marker off as inlines, without the separator space", async () => {
    const [first] = await engine.renderBibliographyAst({
      items: [ZETA],
      styleXml: NUMERIC_STYLE,
    });

    expect(first?.marker).toEqual([{ t: "Str", c: "[1]" }]);
    expect(plainText(first?.content ?? [])).toBe(
      "Ann Zeta. A study of nothing.",
    );
  });

  it("leaves the typed marker unset for a style that renders none", async () => {
    const [first] = await engine.renderBibliographyAst({ items: [ZETA] });

    expect(first?.marker).toBeUndefined();
    expect(plainText(first?.content ?? [])).toContain("Zeta, Ann");
  });

  it("passes the display spans of an entry through untouched", async () => {
    const [first] = await engine.renderBibliographyAst({
      items: [ZETA],
      styleXml: BLOCK_STYLE,
    });

    expect(
      first?.content.map((inline) =>
        inline.t === "Span" ? inline.c[0][1] : inline.t,
      ),
    ).toEqual([["csl-block"], ["csl-indent"]]);
  });

  it("renders no typed entries for an empty item set", async () => {
    await expect(engine.renderBibliographyAst({ items: [] })).resolves.toEqual(
      [],
    );
  });

  it("formats one typed citation per source, in the order they were asked for", async () => {
    const rendered = await engine.renderCitationsAst({
      citations: ["[@zeta20]", "@adams18"],
      items: [
        { ...ZETA, id: "zeta20" },
        { ...ADAMS, id: "adams18" },
      ],
    });

    expect(rendered.map((citation) => plainText(citation.content))).toEqual([
      "(Zeta 2020)",
      "Adams (2018)",
    ]);
    expect(rendered.map((citation) => citation.citations)).toEqual([
      [{ id: "zeta20", mode: "normal" }],
      [{ id: "adams18", mode: "author-in-text" }],
    ]);
  });

  it("names every work a cluster cites, in the mode it cites it", async () => {
    const [cluster] = await engine.renderCitationsAst({
      citations: ["[see @zeta20, p. 3; -@adams18]"],
      items: [
        { ...ZETA, id: "zeta20" },
        { ...ADAMS, id: "adams18" },
      ],
    });

    expect(cluster?.citations).toEqual([
      { id: "zeta20", mode: "normal" },
      { id: "adams18", mode: "suppress-author" },
    ]);
    expect(plainText(cluster?.content ?? [])).toBe("(see Zeta 2020, 3; 2018)");
  });

  it("numbers typed citations across the whole request under a numbered style", async () => {
    const rendered = await engine.renderCitationsAst({
      citations: ["[@zeta20]", "[@adams18]", "[@zeta20]"],
      items: [
        { ...ZETA, id: "zeta20" },
        { ...ADAMS, id: "adams18" },
      ],
      styleXml: NUMERIC_STYLE,
    });

    expect(rendered.map((citation) => plainText(citation.content))).toEqual([
      "[1]",
      "[2]",
      "[1]",
    ]);
  });

  it("renders each occurrence of one source by its place in the request", async () => {
    const rendered = await engine.renderCitationsAst({
      citations: ["[@zeta20]", "[@zeta20]"],
      items: [{ ...ZETA, id: "zeta20" }],
      styleXml: POSITION_STYLE,
    });

    expect(rendered.map((citation) => plainText(citation.content))).toEqual([
      "Zeta",
      "ibid.",
    ]);
  });

  it("carries a note-class style's footnote in the citation content", async () => {
    const [plain, authorInText] = await engine.renderCitationsAst({
      citations: ["[@zeta20]", "@adams18"],
      items: [
        { ...ZETA, id: "zeta20" },
        { ...ADAMS, id: "adams18" },
      ],
      styleXml: NOTE_STYLE,
    });

    expect(citeInlines(plain?.content ?? []).map((inline) => inline.t)).toEqual(
      ["Note"],
    );
    expect(plainText(plain?.content ?? [])).toBe(
      "Ann Zeta, A study of nothing.",
    );
    // The author stays in the running text, with the note beside it.
    expect(
      citeInlines(authorInText?.content ?? []).map((inline) => inline.t),
    ).toEqual(["Str", "Space", "Str", "Note"]);
  });

  it("refuses an answer that does not cover every citation", async () => {
    const rendering = engine.renderCitationsAst({
      citations: ["[@zeta20]", ""],
      items: [{ ...ZETA, id: "zeta20" }],
    });

    await expect(rendering).rejects.toThrow(CitationEngineError);
    await expect(rendering).rejects.toThrow("formatted 1 of 2 citations");
  });

  it("renders nothing typed for an empty request", async () => {
    await expect(
      engine.renderCitationsAst({ citations: [], items: [] }),
    ).resolves.toEqual([]);
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
