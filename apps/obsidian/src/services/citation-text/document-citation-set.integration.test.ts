// @vitest-environment happy-dom
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { CachedMetadata, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getItemsByKey, resolveIndexedKeyLibrary } from "@zotlit/db";

import { FIELD_ZOTERO_KEY } from "@/lib/constants";
import type {
  Citation,
  ReferenceSource,
} from "@/services/citation-index/service";
import {
  createCitationIndexHarness,
  KEY_A,
  KEY_B,
  link,
  makeFile,
} from "@/services/citation-index/test-harness";
import type { CitationIndexHarness } from "@/services/citation-index/test-harness";
import { createCitationEngine } from "@/services/pandoc/engine";
import type { CitationEngine } from "@/services/pandoc/engine";
import { inlineText } from "@/services/pandoc/inline-content";
import { buildReferenceEntries } from "@/views/references/entries";
import type { ReferenceEntry } from "@/views/references/entries";

import { ALPHA } from "./__fixtures__";
import { citationKey } from "./present";
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

/** Prints the author alone, so a rendered citation names the Item it came from. */
const AUTHOR_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Author integration</title>
    <id>http://example.com/author-integration</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><names variable="author"><name form="short"/></names></layout></citation>
  <bibliography><layout><names variable="author"><name/></names></layout></bibliography>
</style>`;

const BODY =
  "@doe2024 then [[Roe 2025#cite:locator=4]] then [[Doe 2024]] then @doe2024.";

/** The Indexed Keys of the keyless Items the collision suites cite. */
const KEY_C = "CCCC2345";
const KEY_D = "DDDD2345";
const KEY_E = "EEEE2345";

/** A personal-library Item, whose bare key is its Indexed Key. */
function item(
  indexedKey: string,
  itemID: number,
  family: string,
): typeof ALPHA {
  return {
    ...ALPHA,
    key: indexedKey,
    itemID,
    indexedKey,
    creators: [{ creatorType: "author", lastName: family, firstName: "Bea" }],
    fields: { ...ALPHA.fields, title: `${family} study`, date: "2021" },
  };
}

/** Every Item the stubbed database answers with, by Indexed Key. */
const ITEMS: Record<string, typeof ALPHA> = {
  [KEY_A]: ALPHA,
  [KEY_B]: item(KEY_B, 2, "Roe"),
  [KEY_C]: item(KEY_C, 3, "Cox"),
  [KEY_D]: item(KEY_D, 4, "Dey"),
  [KEY_E]: item(KEY_E, 5, "Ess"),
};

beforeEach(() => {
  vi.mocked(resolveIndexedKeyLibrary).mockImplementation(
    (_client, indexedKey) => {
      const found = ITEMS[indexedKey];
      return found ? { libraryID: 1, key: found.key } : null;
    },
  );
  vi.mocked(getItemsByKey).mockImplementation((_client, _libraryID, keys) => {
    const found = Object.values(ITEMS).find(({ key }) => key === keys[0]);
    return found ? [found as never] : [];
  });
});

/**
 * A Literature Note for an Item Zotero holds no citation key for, so the
 * derived citekey falls back to the note's own filename.
 */
function addKeylessNote(
  harness: CitationIndexHarness,
  path: string,
  indexedKey: string,
): TFile {
  const note = makeFile(path, "");
  harness.metadataCache.files.set(path, note);
  harness.vault.bodies.set(path, "");
  harness.metadataCache.fileCache.set(path, {
    frontmatter: { [FIELD_ZOTERO_KEY]: indexedKey },
  } as CachedMetadata);
  harness.noteIndex.notes.set(indexedKey, note);
  return note;
}

describe("Document Citation Set integration", { timeout: 60_000 }, () => {
  it("keeps numeric in-text and sidebar assignments aligned across source changes", async () => {
    await using harness = await createCitationIndexHarness(
      { "draft.md": BODY },
      { settings: { "citation.wikilink-citations": true } },
    );
    const { draft, index, metadataCache, settings } = harness;
    const fragmentOffset = BODY.indexOf("[[Roe");
    const fragmentlessOffset = BODY.indexOf("[[Doe");
    metadataCache.fileCache.set("draft.md", {
      links: [
        link("Roe 2025#cite:locator=4", fragmentOffset),
        link("Doe 2024", fragmentlessOffset),
      ],
    } as CachedMetadata);
    await using engine = await openEngine();
    await using text = openText(harness, engine, NUMERIC_STYLE);
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
    expect(
      includedText.formatted.get(
        citationKey({ source: "[@roe2025, p. 4]", works: [KEY_B] }),
      )?.textContent,
    ).toBe("[2]");
    expect(
      includedText.formatted.get(
        citationKey({ source: "[@doe2024]", works: [KEY_A] }),
      )?.textContent,
    ).toBe("[1]");
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
    expect(
      excludedText.formatted.has(
        citationKey({ source: "[@roe2025, p. 4]", works: [KEY_B] }),
      ),
    ).toBe(false);
    expect(
      excludedText.formatted.has(
        citationKey({ source: "[@doe2024]", works: [KEY_A] }),
      ),
    ).toBe(false);
    expect(markers(excludedEntries)).toEqual(["[1]"]);
  });

  it("keeps resolved items from a partial cluster in numeric context", async () => {
    const body = "Partial [@doe2024; @ghost], then complete @roe2025.";
    await using harness = await createCitationIndexHarness({
      "draft.md": body,
    });
    const { draft, index } = harness;
    await using engine = await openEngine();
    await using text = openText(harness, engine, NUMERIC_STYLE);
    await text.ready;

    const set = await index.getDocumentCitationSet(draft);
    const rendered = await text.load(draft);
    const entries = await sidebarEntries(engine, set.citations);

    expect(rendered.formatted.has("[@doe2024; @ghost]")).toBe(false);
    expect(rendered.formatted.get("@roe2025")?.textContent).toBe("[2]");
    expect(markers(entries)).toEqual(["[1]", "[2]", undefined]);
  });

  // Two keyless Items whose Literature Notes share a filename derive one
  // citekey, so a render keyed by that spelling shows one Item for both.
  it("renders each work of a filename collision from its own Item", async () => {
    const body = "First [[folder1/Draft]] then [[folder2/Draft]].";
    await using harness = await createCitationIndexHarness(
      { "draft.md": body },
      { settings: { "citation.wikilink-citations": true } },
    );
    addKeylessNote(harness, "folder1/Draft.md", KEY_C);
    addKeylessNote(harness, "folder2/Draft.md", KEY_D);
    harness.metadataCache.fileCache.set("draft.md", {
      links: [
        link("folder1/Draft", body.indexOf("[[folder1")),
        link("folder2/Draft", body.indexOf("[[folder2")),
      ],
    } as CachedMetadata);
    await using engine = await openEngine();
    await using text = openText(harness, engine, AUTHOR_STYLE);
    await text.ready;

    const { formatted } = await text.load(harness.draft);

    expect(
      formatted.get(citationKey({ source: "[@Draft]", works: [KEY_C] }))
        ?.textContent,
    ).toBe("Cox");
    expect(
      formatted.get(citationKey({ source: "[@Draft]", works: [KEY_D] }))
        ?.textContent,
    ).toBe("Dey");
  });

  // One keyless Item with two Literature Notes is spelled two ways, and a
  // numbering style counts one physical source once however it is spelled.
  it("numbers one work cited under two spellings once", async () => {
    const body = "First [[Papers/Ess]] then [[Archive/Ess2]].";
    await using harness = await createCitationIndexHarness(
      { "draft.md": body },
      { settings: { "citation.wikilink-citations": true } },
    );
    addKeylessNote(harness, "Papers/Ess.md", KEY_E);
    addKeylessNote(harness, "Archive/Ess2.md", KEY_E);
    harness.metadataCache.fileCache.set("draft.md", {
      links: [
        link("Papers/Ess", body.indexOf("[[Papers")),
        link("Archive/Ess2", body.indexOf("[[Archive")),
      ],
    } as CachedMetadata);
    await using engine = await openEngine();
    await using text = openText(harness, engine, NUMERIC_STYLE);
    await text.ready;

    const { formatted } = await text.load(harness.draft);

    expect(
      formatted.get(citationKey({ source: "[@Ess]", works: [KEY_E] }))
        ?.textContent,
    ).toBe("[1]");
    expect(
      formatted.get(citationKey({ source: "[@Ess2]", works: [KEY_E] }))
        ?.textContent,
    ).toBe("[1]");
  });

  // Zotero holds no uniqueness rule for a citation key, and the resolution
  // snapshot is first-wins, so a literal key reaches the winner while a
  // wikilink to the loser still derives that same spelling.
  it("renders a duplicate citation key from the Item each syntax reaches", async () => {
    const body = "@doe2024 then [[Roe 2025]].";
    await using harness = await createCitationIndexHarness(
      { "draft.md": body },
      {
        settings: { "citation.wikilink-citations": true },
        citekeys: [
          { itemID: 1, key: "DOE2024", indexedKey: KEY_A, citekey: "doe2024" },
          { itemID: 2, key: "ROE2025", indexedKey: KEY_B, citekey: "doe2024" },
        ],
      },
    );
    harness.metadataCache.fileCache.set("draft.md", {
      links: [link("Roe 2025", body.indexOf("[["))],
    } as CachedMetadata);
    await using engine = await openEngine();
    await using text = openText(harness, engine, AUTHOR_STYLE);
    await text.ready;

    // The first scan of a document announces itself, which drops a citation
    // text read that raced it; the surfaces answer that by asking again.
    await harness.index.getDocumentCitationSet(harness.draft);
    const { formatted } = await text.load(harness.draft);

    expect(formatted.get("@doe2024")?.textContent).toBe("Zeta");
    expect(
      formatted.get(citationKey({ source: "[@doe2024]", works: [KEY_B] }))
        ?.textContent,
    ).toBe("Roe");
  });
});

/** One CitationText over a harness, formatting through the real engine. */
function openText(
  { app, db, index, noteIndex }: CitationIndexHarness,
  engine: CitationEngine,
  styleXml: string,
): CitationText {
  return new CitationText({
    app,
    db,
    citationIndex: index,
    noteIndex,
    bibliographyRender: {
      renderCitations: (citations, items) =>
        engine.renderCitations({ citations, items, styleXml }),
      on: () => () => undefined,
    },
  });
}

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
  const bibliography = await engine.renderBibliographyAst({
    items,
    styleXml: NUMERIC_STYLE,
  });
  return buildReferenceEntries(citations, sources, {
    bibliography: {
      complete: true,
      entries: new Map(
        bibliography.map(({ id, marker, content }) => [
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
    citekey: id,
    linkpath: `notes/${id}`,
    attachments: [],
  });
  return new Map([
    [KEY_A, source("doe2024", 1, "Doe")],
    [KEY_B, source("roe2025", 2, "Roe")],
  ]);
}

function markers(entries: readonly ReferenceEntry[]): (string | undefined)[] {
  return entries.map((entry) =>
    entry.kind === "rendered" && entry.marker
      ? inlineText(entry.marker)
      : undefined,
  );
}
