import type { CachedMetadata, TFile } from "obsidian";
import { afterEach, describe, expect, it } from "vitest";

import { yieldToMain } from "@/lib/yield-to-main";
import { defaults } from "@/services/settings/schema";

import type { Citation, CitationIndex } from "./service";
import {
  createCitationIndexHarness,
  DatabaseStub,
  KEY_A,
  KEY_B,
  link,
  MemoryStore,
} from "./test-harness";
import type {
  CitationIndexHarness,
  CitationIndexHarnessOptions,
} from "./test-harness";

const harnesses: CitationIndexHarness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0).reverse()) {
    await harness[Symbol.asyncDispose]();
  }
});

async function citationsOf(
  index: CitationIndex,
  file: TFile,
): Promise<Citation[]> {
  return (await index.getDocumentCitationSet(file)).citations;
}

describe("CitationIndex", () => {
  it("lists the literal citekeys of a document with their Reference Numbers", async () => {
    const { draft, index } = await makeHarness({
      "draft.md": "Cited by @doe2024 and @roe2025, then @doe2024 again.",
    });

    const citations = await citationsOf(index, draft);

    expect(citations).toMatchObject([
      { indexedKey: KEY_A, linkpath: "Doe 2024.md", refNumber: 1 },
      { indexedKey: KEY_B, linkpath: "Roe 2025.md", refNumber: 2 },
    ]);
    expect(citations[0]!.occurrences).toHaveLength(2);
  });

  it("keeps a citekey no Literature Note carries", async () => {
    const { draft, index } = await makeHarness({
      "draft.md": "See @typo2024.",
    });

    expect(await citationsOf(index, draft)).toMatchObject([
      { indexedKey: null, linkpath: null, refNumber: 1 },
    ]);
  });

  it("positions an occurrence at its place in the source", async () => {
    const { draft, index } = await makeHarness({
      "draft.md": "# Title\n\nAs @doe2024 wrote.\n",
    });

    const [citation] = await citationsOf(index, draft);

    expect(citation!.occurrences[0]!.position).toEqual({
      start: { line: 2, col: 3, offset: 12 },
      end: { line: 2, col: 11, offset: 20 },
    });
  });

  it("merges wikilink occurrences from the metadata cache in document order", async () => {
    const { draft, index, metadataCache } = await makeHarness(
      { "draft.md": "As @roe2025 wrote, see [[Doe 2024]]." },
      { settings: { "citation.wikilink-citations": true } },
    );
    metadataCache.fileCache.set("draft.md", {
      links: [link("Doe 2024", 23)],
    } as CachedMetadata);

    const citations = await citationsOf(index, draft);

    expect(citations).toMatchObject([
      { indexedKey: KEY_B, refNumber: 1 },
      { indexedKey: KEY_A, linkpath: "Doe 2024", refNumber: 2 },
    ]);
  });

  it("returns one ordered Document Citation Set for both consumers", async () => {
    const body = "First @roe2025, then [[Doe 2024]], then @roe2025.";
    const { draft, index, metadataCache } = await makeHarness(
      { "draft.md": body },
      { settings: { "citation.wikilink-citations": true } },
    );
    metadataCache.fileCache.set("draft.md", {
      links: [link("Doe 2024", body.indexOf("[["))],
    } as CachedMetadata);

    const set = await index.getDocumentCitationSet(draft);

    expect(set.occurrences.map(({ kind, raw }) => [kind, raw])).toEqual([
      ["citekey", "roe2025"],
      ["wikilink", "Doe 2024"],
      ["citekey", "roe2025"],
    ]);
    expect(set.citations).toMatchObject([
      { indexedKey: KEY_B, refNumber: 1, occurrences: [{}, {}] },
      { indexedKey: KEY_A, refNumber: 2, occurrences: [{}] },
    ]);
  });

  it("admits only eligible Literature Note wikilinks to the shared set", async () => {
    const { draft, index, metadataCache } = await makeHarness(
      { "draft.md": "links" },
      { settings: { "citation.wikilink-citations": true } },
    );
    metadataCache.fileCache.set("draft.md", {
      links: [
        link("Doe 2024", 0),
        link("Doe 2024#cite:locator=4", 20),
        link("Doe 2024#cite:", 40),
        link("Doe 2024#Heading", 60),
        link("Doe 2024#^block", 80),
        link("Doe 2024", 100, "[[Doe 2024|Doe]]"),
        link("Doe 2024", 120, "![[Doe 2024]]"),
        link("Doe 2024", 140, "[Doe](Doe 2024)"),
      ],
    } as CachedMetadata);

    const set = await index.getDocumentCitationSet(draft);

    expect(set.occurrences.map(({ raw }) => raw)).toEqual([
      "Doe 2024",
      "Doe 2024",
    ]);
  });

  it("recomputes membership after a source choice without rebuilding the scan", async () => {
    const body = "See @roe2025 and [[Doe 2024]].";
    const { draft, index, metadataCache, settings, vault } = await makeHarness({
      "draft.md": body,
    });
    metadataCache.fileCache.set("draft.md", {
      links: [link("Doe 2024", body.indexOf("[["))],
    } as CachedMetadata);
    let changed = 0;
    index.on("membership-changed", () => changed++);

    expect(
      (await index.getDocumentCitationSet(draft)).occurrences.map(
        ({ kind }) => kind,
      ),
    ).toEqual(["citekey"]);
    settings.update({
      "citation.pandoc-citations": false,
      "citation.wikilink-citations": true,
    });
    expect(
      (await index.getDocumentCitationSet(draft)).occurrences.map(
        ({ kind }) => kind,
      ),
    ).toEqual(["wikilink"]);

    expect(changed).toBe(1);
    expect(vault.reads).toEqual(["draft.md"]);
  });

  it("applies all four independent source combinations", async () => {
    const body = "See @roe2025 and [[Doe 2024]].";
    const { draft, index, metadataCache, settings } = await makeHarness({
      "draft.md": body,
    });
    metadataCache.fileCache.set("draft.md", {
      links: [link("Doe 2024", body.indexOf("[["))],
    } as CachedMetadata);

    expect(
      (await index.getDocumentCitationSet(draft)).occurrences.map(
        ({ kind }) => kind,
      ),
    ).toEqual(["citekey"]);

    settings.update({ "citation.wikilink-citations": true });
    expect(
      (await index.getDocumentCitationSet(draft)).occurrences.map(
        ({ kind }) => kind,
      ),
    ).toEqual(["citekey", "wikilink"]);

    settings.update({ "citation.pandoc-citations": false });
    expect(
      (await index.getDocumentCitationSet(draft)).occurrences.map(
        ({ kind }) => kind,
      ),
    ).toEqual(["wikilink"]);

    settings.update({ "citation.wikilink-citations": false });
    expect(await index.getDocumentCitationSet(draft)).toMatchObject({
      occurrences: [],
      citations: [],
      errors: [],
    });
  });

  it("reports malformed Citation Fragments without numbering them", async () => {
    const body = "Bad [[Doe 2024#cite:locator=]] then @roe2025.";
    const { draft, index, metadataCache } = await makeHarness(
      { "draft.md": body },
      { settings: { "citation.wikilink-citations": true } },
    );
    const offset = body.indexOf("[[");
    metadataCache.fileCache.set("draft.md", {
      links: [link("Doe 2024#cite:locator=", offset)],
    } as CachedMetadata);

    const set = await index.getDocumentCitationSet(draft);

    expect(set.citations).toMatchObject([{ indexedKey: KEY_B, refNumber: 1 }]);
    expect(set.errors).toEqual([
      {
        kind: "malformed-wikilink",
        occurrence: {
          kind: "wikilink",
          raw: "Doe 2024",
          position: link("Doe 2024#cite:locator=", offset).position,
        },
      },
    ]);
  });

  it("leaves wikilinks out while Wikilink Citations is off", async () => {
    const { draft, index, metadataCache } = await makeHarness({
      "draft.md": "As @roe2025 wrote, see [[Doe 2024]].",
    });
    metadataCache.fileCache.set("draft.md", {
      links: [link("Doe 2024", 23)],
    } as CachedMetadata);

    expect(await citationsOf(index, draft)).toMatchObject([
      { indexedKey: KEY_B, refNumber: 1 },
    ]);
  });

  it("leaves citekeys inside code, math, comments, and frontmatter out", async () => {
    const { draft, index } = await makeHarness({
      "draft.md": [
        "---",
        "cite: @doe2024",
        "---",
        "",
        "```md",
        "@doe2024",
        "```",
        "",
        "    @doe2024",
        "",
        "Inline `@doe2024`, math $x = @doe2024$, and %% @doe2024 %% too.",
        "",
        "$$",
        "@doe2024",
        "$$",
        "",
        "Only @roe2025 counts.",
      ].join("\n"),
    });

    expect(await citationsOf(index, draft)).toMatchObject([
      { indexedKey: KEY_B, refNumber: 1 },
    ]);
  });

  // Indented list content is no code block, an unpaired backtick opens no code
  // span, and a price pair is no math — each would swallow a real citation.
  it("keeps citekeys that only look like code or math", async () => {
    const { draft, index } = await makeHarness({
      "draft.md": [
        "- item",
        "",
        "    Indented under the list, citing @doe2024.",
        "",
        "It cost $5 and @roe2025 says $6 isn't a formula.",
        "",
        "A lone ` backtick keeps @doe2024 readable.",
      ].join("\n"),
    });

    const citations = await citationsOf(index, draft);

    expect(citations).toMatchObject([
      { indexedKey: KEY_A, refNumber: 1 },
      { indexedKey: KEY_B, refNumber: 2 },
    ]);
    expect(citations[0]!.occurrences).toHaveLength(2);
  });

  it("rescans a document when its metadata changes", async () => {
    const { draft, index, metadataCache } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });
    await citationsOf(index, draft);

    metadataCache.change(draft, "As @roe2025 wrote.");

    expect(await citationsOf(index, draft)).toMatchObject([
      { indexedKey: KEY_B, refNumber: 1 },
    ]);
  });

  it("stays quiet when a change leaves the citekeys identical", async () => {
    const { draft, index, metadataCache } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });
    await citationsOf(index, draft);
    let notified = 0;
    index.on("changed", () => notified++);

    metadataCache.change(draft, "As @doe2024 wrote.");

    expect(notified).toBe(0);
  });

  it("reports a document whose citekeys changed", async () => {
    const { draft, index, metadataCache } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });
    await citationsOf(index, draft);
    const changed: string[] = [];
    index.on("changed", (path) => changed.push(path));

    metadataCache.change(draft, "As @doe2024 and @roe2025 wrote.");

    expect(changed).toEqual(["draft.md"]);
  });

  it("keeps a renamed document indexed under its new path", async () => {
    const { draft, index, vault } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });
    await citationsOf(index, draft);

    vault.rename(draft, "Notes/paper.md");

    expect(await citationsOf(index, draft)).toMatchObject([
      { indexedKey: KEY_A },
    ]);
    expect(vault.bodies.has("draft.md")).toBe(false);
  });

  it("drops a deleted document", async () => {
    const { draft, index, vault, workspace } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });
    workspace.layoutReady();
    await index.whenIndexed();
    const changed: string[] = [];
    index.on("changed", (path) => changed.push(path));

    vault.deleteFile(draft);

    expect(changed).toEqual(["draft.md"]);
    expect(await citationsOf(index, draft)).toEqual([]);
  });

  it("answers for a document the backfill has not reached", async () => {
    const { draft, index } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });

    expect(await citationsOf(index, draft)).toMatchObject([
      { indexedKey: KEY_A },
    ]);
  });

  it("covers the vault once the backfill finishes", async () => {
    const { index, metadataCache, workspace } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
      "other.md": "As @roe2025 wrote.",
    });
    let backfilled = false;
    void index.whenIndexed().then(() => (backfilled = true));

    expect(backfilled).toBe(false);
    workspace.layoutReady();
    await index.whenIndexed();

    const other = metadataCache.files.get("other.md")!;
    expect(await citationsOf(index, other)).toMatchObject([
      { indexedKey: KEY_B },
    ]);
  });

  it("settles whenIndexed when disposal precedes the backfill", async () => {
    const { index } = await makeHarness({ "draft.md": "As @doe2024 wrote." });
    const waiting = index.whenIndexed();

    await index[Symbol.asyncDispose]();

    await expect(waiting).resolves.toBeUndefined();
    await expect(index.whenIndexed()).resolves.toBeUndefined();
  });

  it("keeps internal scans active while Pandoc Citations is off", async () => {
    const { draft, index, metadataCache, settings, vault, workspace } =
      await makeHarness(
        { "draft.md": "As @doe2024 wrote, see [[Roe 2025]]." },
        {
          settings: {
            "citation.pandoc-citations": false,
            "citation.wikilink-citations": true,
          },
        },
      );
    metadataCache.fileCache.set("draft.md", {
      links: [link("Roe 2025", 23)],
    } as CachedMetadata);

    expect(await citationsOf(index, draft)).toMatchObject([
      { indexedKey: KEY_B, refNumber: 1 },
    ]);
    expect(index.resolveCitekey("doe2024")).toMatchObject({
      indexedKey: KEY_A,
    });

    metadataCache.change(draft, "As @roe2025 wrote, see [[Roe 2025]].");
    settings.update({ "citation.pandoc-citations": true });
    expect(await citationsOf(index, draft)).toMatchObject([
      {
        indexedKey: KEY_B,
        refNumber: 1,
        occurrences: [{ kind: "citekey", raw: "roe2025" }],
      },
    ]);

    settings.update({ "citation.pandoc-citations": false });
    workspace.layoutReady();
    await index.whenIndexed();
    vault.reads.length = 0;
    await index.reset();
    await index.whenIndexed();
    expect(vault.reads).toContain("draft.md");
  });

  it("stops indexing after disposal", async () => {
    const { draft, index, metadataCache, store } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });
    await citationsOf(index, draft);
    store.writes.length = 0;
    const changed: string[] = [];
    index.on("changed", (path) => changed.push(path));

    await index[Symbol.asyncDispose]();
    metadataCache.change(draft, "As @roe2025 wrote.");

    expect(changed).toEqual([]);
    expect(store.writes).toEqual([]);
  });
});

describe("CitationIndex persistence", () => {
  it("adopts a stored scan for a file the vault has not touched", async () => {
    const store = new MemoryStore();
    await warmVault({ "draft.md": "As @doe2024 wrote." }, store);

    const { draft, index, vault, workspace } = await makeHarness(
      { "draft.md": "As @doe2024 wrote." },
      { store },
    );
    workspace.layoutReady();
    await index.whenIndexed();

    expect(vault.reads).toEqual([]);
    expect(await citationsOf(index, draft)).toMatchObject([
      { indexedKey: KEY_A, refNumber: 1 },
    ]);
  });

  it("re-scans a file edited to the same length while the app was closed", async () => {
    const store = new MemoryStore();
    await warmVault({ "draft.md": "As @doe2024 wrote." }, store);

    const { draft, index, vault, workspace } = await makeHarness(
      { "draft.md": "As @roe2025 wrote." },
      { store },
    );
    workspace.layoutReady();
    await index.whenIndexed();

    expect(vault.reads).toEqual(["draft.md"]);
    expect(await citationsOf(index, draft)).toMatchObject([
      { indexedKey: KEY_B, refNumber: 1 },
    ]);
  });

  it("writes the record of the one file that changed", async () => {
    const { draft, index, metadataCache, store, workspace } = await makeHarness(
      {
        "draft.md": "As @doe2024 wrote.",
        "other.md": "As @roe2025 wrote.",
      },
    );
    workspace.layoutReady();
    await index.whenIndexed();
    store.writes.length = 0;

    metadataCache.change(draft, "As @doe2024 and @roe2025 wrote.");

    expect(store.writes).toEqual(["draft.md"]);
  });

  it("forgets the stored scan of a deleted document", async () => {
    const { draft, index, store, vault, workspace } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });
    workspace.layoutReady();
    await index.whenIndexed();

    vault.deleteFile(draft);

    expect(store.records.has("draft.md")).toBe(false);
  });

  it("clears the stored scans and rebuilds on reset", async () => {
    const store = new MemoryStore();
    const { draft, index, vault, workspace } = await makeHarness(
      { "draft.md": "As @doe2024 wrote." },
      { store },
    );
    workspace.layoutReady();
    await index.whenIndexed();
    vault.reads.length = 0;

    await index.reset();
    await index.whenIndexed();

    expect(vault.reads).toContain("draft.md");
    expect(store.records.has("draft.md")).toBe(true);
    expect(await citationsOf(index, draft)).toMatchObject([
      { indexedKey: KEY_A },
    ]);
  });

  it("keeps a backfill in flight from writing its scan past a reset", async () => {
    const store = new MemoryStore();
    const { draft, index, vault, workspace } = await makeHarness(
      { "draft.md": "As @doe2024 wrote." },
      { store },
    );
    const release = vault.hold("draft.md");
    workspace.layoutReady();
    // The backfill runs until it parks on the read of `draft.md`.
    await yieldToMain();

    vault.write(draft, "As @roe2025 wrote.");
    await index.reset();
    await index.whenIndexed();
    release();
    await yieldToMain();

    // The parked read still holds the pre-reset body; a later session must not
    // find it, so the restart adopts what the rebuild wrote and reads nothing.
    const restored = await makeHarness(
      { "draft.md": "As @roe2025 wrote." },
      { store },
    );
    restored.workspace.layoutReady();
    await restored.index.whenIndexed();

    expect(restored.vault.reads).toEqual([]);
    expect(await citationsOf(restored.index, restored.draft)).toMatchObject([
      { indexedKey: KEY_B },
    ]);
  });
});

describe("CitationIndex resolution", () => {
  it("resolves a citekey with no Literature Note in the vault", async () => {
    const { draft, index } = await makeHarness(
      { "draft.md": "As @doe2024 wrote." },
      { notes: false },
    );

    expect(await citationsOf(index, draft)).toMatchObject([
      { indexedKey: KEY_A, linkpath: null },
    ]);
    expect(index.citekeyOf(KEY_A)).toBe("doe2024");
  });

  it("stays unresolved before the snapshot is warm, then resolves once the read settles", async () => {
    const db = new DatabaseStub({ readyImmediately: false });
    const { index } = await makeHarness({}, { db, notes: false });

    expect(index.resolveCitekey("doe2024")).toBeNull();
    const waiting = index.whenResolved();

    db.settle();
    await waiting;

    expect(index.resolveCitekey("doe2024")).toEqual({
      itemID: 1,
      indexedKey: KEY_A,
    });
  });

  it("rebuilds on the database changed event, dropping the old key and adding the new one", async () => {
    const { index, citekeys, db } = await makeHarness({}, { notes: false });
    expect(index.resolveCitekey("doe2024")).not.toBeNull();
    expect(index.resolveCitekey("doe2024b")).toBeNull();

    citekeys.rows = citekeys.rows.map((row) =>
      row.citekey === "doe2024" ? { ...row, citekey: "doe2024b" } : row,
    );
    let notified = 0;
    index.on("resolution-changed", () => notified++);

    db.changed();
    await index.whenResolved();
    await yieldToMain();

    expect(notified).toBeGreaterThan(0);
    expect(index.resolveCitekey("doe2024")).toBeNull();
    expect(index.resolveCitekey("doe2024b")).toEqual({
      itemID: 1,
      indexedKey: KEY_A,
    });
  });

  it("emits nothing when a rebuild finds identical rows", async () => {
    const { index, db } = await makeHarness({}, { notes: false });
    let notified = 0;
    index.on("resolution-changed", () => notified++);

    db.changed();
    await yieldToMain();

    expect(notified).toBe(0);
  });

  it("reads the configured citation library and rebuilds when it changes", async () => {
    const { index, citekeys, settings } = await makeHarness(
      {},
      { notes: false },
    );
    expect(citekeys.calls).toContain(defaults["zotero.citation-library"]);

    settings.update({ "zotero.citation-library": 2 });
    await index.whenResolved();
    await yieldToMain();

    expect(citekeys.calls).toContain(2);
  });

  it("settles whenResolved unresolved when the database is degraded", async () => {
    const db = new DatabaseStub();
    db.state = "degraded";
    const { index } = await makeHarness({}, { db, notes: false });

    await index.whenResolved();

    expect(index.resolveCitekey("doe2024")).toBeNull();
  });

  it("settles whenResolved when disposal interrupts the first rebuild", async () => {
    const db = new DatabaseStub({ readyImmediately: false });
    const { index } = await makeHarness({}, { db, notes: false });
    const waiting = index.whenResolved();

    await index[Symbol.asyncDispose]();

    await expect(waiting).resolves.toBeUndefined();
    await expect(index.whenResolved()).resolves.toBeUndefined();
  });

  it("resolves with a Literature Note's path as linkpath", async () => {
    const { draft, index } = await makeHarness({
      "draft.md": "As @doe2024 wrote.",
    });

    expect(await citationsOf(index, draft)).toMatchObject([
      { indexedKey: KEY_A, linkpath: "Doe 2024.md" },
    ]);
  });
});

/** Runs one index to completion over `documents`, leaving its scans in `store`. */
async function warmVault(
  documents: Record<string, string>,
  store: MemoryStore,
): Promise<void> {
  const { index, workspace } = await makeHarness(documents, { store });
  workspace.layoutReady();
  await index.whenIndexed();
  await index[Symbol.asyncDispose]();
}

async function makeHarness(
  documents: Record<string, string>,
  options: CitationIndexHarnessOptions = {},
): Promise<CitationIndexHarness> {
  const harness = await createCitationIndexHarness(documents, options);
  harnesses.push(harness);
  return harness;
}
