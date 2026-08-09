// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { CachedMetadata } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getItemsByKey, resolveIndexedKeyLibrary } from "@zotlit/db";

import type { Citation } from "@/services/citation-index/service";
import {
  createCitationIndexHarness,
  KEY_A,
  KEY_B,
  link,
} from "@/services/citation-index/test-harness";
import { createCitationEngine } from "@/services/pandoc/engine";
import type {
  BibliographyEntry,
  CitationEngine,
} from "@/services/pandoc/engine";
import { buildReferenceEntries } from "@/views/references/entries";
import type {
  ReferenceEntry,
  ReferenceSource,
} from "@/views/references/entries";

import { ALPHA } from "./__fixtures__";
import { CitationText } from "./service";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    getZoteroIdentity: () => ({
      userID: 1,
      localUserKey: null,
      username: null,
    }),
    resolveIndexedKeyLibrary: vi.fn(),
    getItemsByKey: vi.fn(),
  };
});

const WASM_PATH = join(
  dirname(createRequire(import.meta.url).resolve("pandoc-wasm")),
  "pandoc.wasm",
);

const NUMERIC_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Numeric integration</title>
    <id>http://example.com/numeric-integration</id>
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

const BODY =
  "@doe2024 then [[Roe 2025#cite:locator=4]] then [[Doe 2024]] then @doe2024.";

const BETA = {
  ...ALPHA,
  key: "BETA2345",
  itemID: 2,
  indexedKey: KEY_B,
  creators: [{ creatorType: "author", lastName: "Roe", firstName: "Bea" }],
  fields: { ...ALPHA.fields, title: "Roe study", date: "2021" },
};

beforeEach(() => {
  vi.mocked(resolveIndexedKeyLibrary).mockImplementation(
    (_client, indexedKey) =>
      indexedKey === KEY_A
        ? { libraryID: 1, key: "ALPHA123" }
        : { libraryID: 1, key: "BETA2345" },
  );
  vi.mocked(getItemsByKey).mockImplementation((_client, _libraryID, keys) =>
    keys[0] === "ALPHA123" ? [ALPHA as never] : [BETA as never],
  );
});

describe("Document Citation Set integration", { timeout: 60_000 }, () => {
  it("keeps numeric in-text and sidebar assignments aligned across source changes", async () => {
    await using harness = await createCitationIndexHarness(
      { "draft.md": BODY },
      { settings: { "citation.wikilink-citations": true } },
    );
    const { app, draft, index, metadataCache, noteIndex, settings, db } =
      harness;
    const fragmentOffset = BODY.indexOf("[[Roe");
    const fragmentlessOffset = BODY.indexOf("[[Doe");
    metadataCache.fileCache.set("draft.md", {
      links: [
        link("Roe 2025#cite:locator=4", fragmentOffset),
        link("Doe 2024", fragmentlessOffset),
      ],
    } as CachedMetadata);
    await using engine = await openEngine();
    await using text = new CitationText({
      app,
      db,
      citationIndex: index,
      noteIndex,
      bibliographyRender: {
        renderCitations: (citations, items) =>
          engine.renderCitations({
            citations,
            items,
            styleXml: NUMERIC_STYLE,
          }),
        on: () => () => undefined,
      },
    });
    await text.ready;

    const includedSet = await index.getDocumentCitationSet(draft);
    const includedText = await text.load(draft);
    const includedEntries = await sidebarEntries(engine, includedSet.citations);

    expect(includedSet.occurrences.map(({ kind }) => kind)).toEqual([
      "citekey",
      "wikilink",
      "wikilink",
      "citekey",
    ]);
    expect(includedSet.citations[0]?.occurrences).toHaveLength(3);
    expect(includedText.formatted.get("@doe2024")?.textContent).toBe("[1]");
    expect(includedText.formatted.get("[@roe2025, p. 4]")?.textContent).toBe(
      "[2]",
    );
    expect(includedText.formatted.get("[@doe2024]")?.textContent).toBe("[1]");
    expect(markers(includedEntries)).toEqual(["[1]", "[2]"]);

    settings.update({ "citation.wikilink-citations": false });
    const excludedSet = await index.getDocumentCitationSet(draft);
    const excludedText = await text.load(draft);
    const excludedEntries = await sidebarEntries(engine, excludedSet.citations);

    expect(excludedSet.occurrences.map(({ kind }) => kind)).toEqual([
      "citekey",
      "citekey",
    ]);
    expect(excludedSet.citations[0]?.occurrences).toHaveLength(2);
    expect(excludedText.formatted.get("@doe2024")?.textContent).toBe("[1]");
    expect(excludedText.formatted.has("[@roe2025, p. 4]")).toBe(false);
    expect(excludedText.formatted.has("[@doe2024]")).toBe(false);
    expect(markers(excludedEntries)).toEqual(["[1]"]);
  });

  it("keeps resolved items from a partial cluster in numeric context", async () => {
    const body = "Partial [@doe2024; @ghost], then complete @roe2025.";
    await using harness = await createCitationIndexHarness({
      "draft.md": body,
    });
    const { app, draft, index, noteIndex, db } = harness;
    await using engine = await openEngine();
    await using text = new CitationText({
      app,
      db,
      citationIndex: index,
      noteIndex,
      bibliographyRender: {
        renderCitations: (citations, items) =>
          engine.renderCitations({
            citations,
            items,
            styleXml: NUMERIC_STYLE,
          }),
        on: () => () => undefined,
      },
    });
    await text.ready;

    const set = await index.getDocumentCitationSet(draft);
    const rendered = await text.load(draft);
    const entries = await sidebarEntries(engine, set.citations);

    expect(rendered.formatted.has("[@doe2024; @ghost]")).toBe(false);
    expect(rendered.formatted.get("@roe2025")?.textContent).toBe("[2]");
    expect(markers(entries)).toEqual(["[1]", "[2]", undefined]);
  });
});

async function openEngine(): Promise<CitationEngine> {
  return createCitationEngine(await readFile(WASM_PATH));
}

async function sidebarEntries(
  engine: CitationEngine,
  citations: readonly Citation[],
): Promise<ReferenceEntry[]> {
  const sources = referenceSources();
  const items = citations.flatMap(({ indexedKey }) => {
    const source = indexedKey && sources.get(indexedKey);
    return source ? [source.csl] : [];
  });
  const bibliography = await engine.renderBibliography({
    items,
    styleXml: NUMERIC_STYLE,
  });
  return buildReferenceEntries(citations, sources, {
    bibliography: {
      complete: true,
      entries: new Map(
        bibliography.map(({ id, marker, content }: BibliographyEntry) => [
          id,
          { marker, content },
        ]),
      ),
    },
  });
}

function referenceSources(): ReadonlyMap<string, ReferenceSource> {
  const source = (
    id: string,
    itemID: number,
    family: string,
  ): ReferenceSource => ({
    csl: {
      id,
      type: "book",
      title: `${family} study`,
      author: [{ family }],
      issued: { "date-parts": [[2020 + itemID]] },
    },
    summary: `${family} (${2020 + itemID})`,
    itemKey: id,
    itemID,
    groupID: null,
    attachments: [],
  });
  return new Map([
    [KEY_A, source("doe2024", 1, "Doe")],
    [KEY_B, source("roe2025", 2, "Roe")],
  ]);
}

function markers(entries: readonly ReferenceEntry[]): (string | undefined)[] {
  return entries.map((entry) =>
    entry.kind === "rendered" ? entry.marker : undefined,
  );
}
