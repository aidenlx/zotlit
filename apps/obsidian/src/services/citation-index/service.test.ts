import { TFile } from "obsidian";
import type { CachedMetadata } from "obsidian";
import { afterEach, describe, expect, it } from "vitest";

import { yieldToMain } from "@/lib/yield-to-main";

import type { CitedBySnapshot, Citation, CitationIndex } from "./service";
import {
  createCitationIndexHarness,
  DatabaseStub,
  GROUP_LIBRARY_ID,
  groupLibrary,
  KEY_A,
  KEY_B,
  LibraryScopeStub,
  link,
  MemoryStore,
  MY_LIBRARY_ID,
  personalLibrary,
  SettingsStub,
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

  it("reports which syntaxes admit their occurrences, and follows a settings update", async () => {
    const { index, settings } = await makeHarness({});

    expect(index.syntaxes()).toEqual({
      citekey: "included",
      wikilink: "excluded",
    });

    settings.update({
      "citation.pandoc-citations": false,
      "citation.wikilink-citations": true,
    });

    expect(index.syntaxes()).toEqual({
      citekey: "excluded",
      wikilink: "included",
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
      kind: "unique",
      item: { indexedKey: KEY_A },
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

    expect(index.resolveCitekey("doe2024")).toEqual({ kind: "missing" });
    const waiting = index.whenResolved();

    db.settle();
    await waiting;

    expect(index.resolveCitekey("doe2024")).toEqual({
      kind: "unique",
      item: {
        itemID: 1,
        libraryID: MY_LIBRARY_ID,
        key: "DOE2024",
        indexedKey: KEY_A,
      },
    });
  });

  it("rebuilds on the database changed event, dropping the old key and adding the new one", async () => {
    const { index, citekeys, db } = await makeHarness({}, { notes: false });
    expect(index.resolveCitekey("doe2024").kind).toBe("unique");
    expect(index.resolveCitekey("doe2024b").kind).toBe("missing");

    citekeys.rows = citekeys.rows.map((row) =>
      row.citekey === "doe2024" ? { ...row, citekey: "doe2024b" } : row,
    );
    let notified = 0;
    index.on("resolution-changed", () => notified++);

    db.changed();
    await index.whenResolved();
    await yieldToMain();

    expect(notified).toBeGreaterThan(0);
    expect(index.resolveCitekey("doe2024")).toEqual({ kind: "missing" });
    expect(index.resolveCitekey("doe2024b")).toMatchObject({
      kind: "unique",
      item: { itemID: 1, indexedKey: KEY_A },
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

  it("reads every local library and rebuilds when Library Scope changes", async () => {
    const libraryScope = new LibraryScopeStub([
      personalLibrary(),
      groupLibrary(),
    ]);
    const { index, citekeys } = await makeHarness(
      {},
      { notes: false, libraryScope },
    );
    expect(citekeys.calls).toEqual([MY_LIBRARY_ID, GROUP_LIBRARY_ID]);

    citekeys.calls.length = 0;
    libraryScope.select([personalLibrary()]);
    await index.whenResolved();
    await yieldToMain();

    expect(citekeys.calls).toEqual([MY_LIBRARY_ID, GROUP_LIBRARY_ID]);
  });

  it("settles whenResolved unresolved when the database is degraded", async () => {
    const db = new DatabaseStub();
    db.state = "degraded";
    const { index } = await makeHarness({}, { db, notes: false });

    await index.whenResolved();

    expect(index.resolveCitekey("doe2024")).toEqual({ kind: "missing" });
  });

  it("settles whenResolved when disposal interrupts the first rebuild", async () => {
    const db = new DatabaseStub({ readyImmediately: false });
    const { index } = await makeHarness({}, { db, notes: false });
    const waiting = index.whenResolved();

    await index[Symbol.asyncDispose]();

    await expect(waiting).resolves.toBeUndefined();
    await expect(index.whenResolved()).resolves.toBeUndefined();
  });

  it("observes resolved literal citekeys grouped by path and source position", async () => {
    const { index, workspace } = await makeHarness({
      "z-last.md": "@doe2024 later, @doe2024 first.",
      "a-first.md": "@doe2024.",
      "unresolved.md": "@missing.",
    });
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

    await yieldToMain();
    expect(snapshots).toMatchObject([
      { coverage: "indexing", resolution: "ready", groups: [] },
    ]);
    workspace.layoutReady();
    await index.whenIndexed();

    expect(snapshots).toHaveLength(4);
    expect(snapshots.at(-1)).toMatchObject({
      coverage: "complete",
      resolution: "ready",
      groups: [
        { path: "a-first.md", occurrences: [{ raw: "doe2024" }] },
        {
          path: "z-last.md",
          occurrences: [{ raw: "doe2024" }, { raw: "doe2024" }],
        },
      ],
    });
    expect(
      snapshots.at(-1)!.groups[1]!.occurrences[0]!.position.start.offset,
    ).toBe(0);
  });

  it("orders occurrences with the same start position deterministically", async () => {
    const { draft, index, metadataCache, workspace } = await makeHarness(
      { "draft.md": "@doe2024" },
      { settings: { "citation.wikilink-citations": true } },
    );
    metadataCache.fileCache.set(draft.path, {
      links: [link("Doe 2024", 0)],
    } as CachedMetadata);
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

    workspace.layoutReady();
    await index.whenIndexed();

    expect(
      snapshots
        .at(-1)
        ?.groups[0]?.occurrences.map(
          ({ kind, position }) => [kind, position.end.offset] as const,
        ),
    ).toEqual([
      ["citekey", 8],
      ["wikilink", 12],
    ]);
  });

  it("publishes first only after listener registration is ready", async () => {
    const settings = new SettingsStub({}, { readyImmediately: false });
    const { index } = await makeHarness(
      { "draft.md": "@doe2024." },
      { settingsService: settings, awaitReady: false },
    );
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

    await yieldToMain();
    expect(snapshots).toEqual([]);

    settings.settle();
    await index.ready;
    await yieldToMain();
    expect(snapshots).toHaveLength(1);
  });

  it("stays silent when disposed during listener registration", async () => {
    const settings = new SettingsStub({}, { readyImmediately: false });
    const { index } = await makeHarness(
      { "draft.md": "@doe2024." },
      { settingsService: settings, awaitReady: false },
    );
    const snapshots: CitedBySnapshot[] = [];
    const stop = index.observeCitedBy(KEY_A, (snapshot) =>
      snapshots.push(snapshot),
    );

    stop();
    settings.settle();
    await index.ready;
    await yieldToMain();

    expect(snapshots).toEqual([]);
  });

  it("omits literal occurrences while Pandoc citation membership is off", async () => {
    const { index, workspace } = await makeHarness(
      { "draft.md": "@doe2024." },
      { settings: { "citation.pandoc-citations": false } },
    );
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

    workspace.layoutReady();
    await index.whenIndexed();

    expect(snapshots.at(-1)).toMatchObject({
      groups: [],
      coverage: "complete",
    });
  });

  it("omits wikilink occurrences while Wikilink citation membership is off", async () => {
    const body = "See [[Doe 2024]].";
    const { index, metadataCache, workspace } = await makeHarness({
      "draft.md": body,
    });
    metadataCache.fileCache.set("draft.md", {
      links: [link("Doe 2024", body.indexOf("[["))],
    } as CachedMetadata);
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

    workspace.layoutReady();
    await index.whenIndexed();

    expect(snapshots.at(-1)).toMatchObject({
      groups: [],
      coverage: "complete",
    });
  });

  it("republishes the reverse observation after a source choice", async () => {
    const { index, settings, workspace } = await makeHarness(
      { "draft.md": "@doe2024." },
      { settings: { "citation.pandoc-citations": false } },
    );
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

    workspace.layoutReady();
    await index.whenIndexed();
    expect(snapshots.at(-1)).toMatchObject({ groups: [] });

    settings.update({ "citation.pandoc-citations": true });
    await yieldToMain();

    expect(snapshots.at(-1)).toMatchObject({
      groups: [{ path: "draft.md" }],
    });
  });

  it("omits a restored scan that no longer describes its file", async () => {
    const store = new MemoryStore();
    await warmVault({ "draft.md": "As @doe2024 wrote." }, store);
    const { index } = await makeHarness(
      { "draft.md": "As @roe2025 wrote." },
      { store },
    );
    const snapshots: CitedBySnapshot[] = [];

    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
    await yieldToMain();

    expect(snapshots).toMatchObject([{ coverage: "indexing", groups: [] }]);
  });

  it("reports degraded coverage while retaining successful scans", async () => {
    const { index, vault, workspace } = await makeHarness({
      "a-good.md": "@doe2024.",
      "z-bad.md": "@doe2024.",
    });
    vault.fail("z-bad.md");
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

    workspace.layoutReady();
    await index.whenIndexed();

    expect(snapshots.at(-1)).toMatchObject({
      coverage: "degraded",
      groups: [{ path: "a-good.md" }],
    });
  });

  it("retains resolved results when citation-key resolution degrades", async () => {
    const { citekeys, db, index, workspace } = await makeHarness({
      "draft.md": "@doe2024.",
    });
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
    workspace.layoutReady();
    await index.whenIndexed();

    citekeys.error = new Error("database read failed");
    db.changed();
    await yieldToMain();

    expect(snapshots.at(-1)).toMatchObject({
      resolution: "degraded",
      groups: [{ path: "draft.md" }],
    });
  });

  it("retains wikilinks while resolution settles from resolving to degraded", async () => {
    const db = new DatabaseStub({ readyImmediately: false });
    db.state = "degraded";
    const body = "See [[Doe 2024]].";
    const { draft, index, metadataCache, workspace } = await makeHarness(
      { "draft.md": body },
      { db, settings: { "citation.wikilink-citations": true } },
    );
    metadataCache.fileCache.set("draft.md", {
      links: [link("Doe 2024", body.indexOf("[["))],
    } as CachedMetadata);
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

    workspace.layoutReady();
    await index.whenIndexed();
    expect(snapshots.at(-1)).toMatchObject({
      resolution: "resolving",
      groups: [{ path: draft.path, occurrences: [{ kind: "wikilink" }] }],
    });

    db.settle();
    await index.whenResolved();
    await yieldToMain();
    expect(snapshots.at(-1)).toMatchObject({
      resolution: "degraded",
      groups: [{ path: draft.path, occurrences: [{ kind: "wikilink" }] }],
    });
  });

  it("returns to indexing when reset starts a new pass", async () => {
    const { index, vault, workspace } = await makeHarness({
      "draft.md": "@doe2024.",
    });
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
    workspace.layoutReady();
    await index.whenIndexed();
    const release = vault.hold("draft.md");

    await index.reset();
    await yieldToMain();
    expect(snapshots.at(-1)?.coverage).toBe("indexing");

    release();
    await index.whenIndexed();
    expect(snapshots.at(-1)?.coverage).toBe("complete");
  });

  it("combines eligible wikilinks and literal citekeys through Item identity", async () => {
    const body = [
      "@doe2024",
      "[[Doe 2024]]",
      "[[Doe 2024#cite:locator=4]]",
      "[[Doe 2024|alias]]",
      "![[Doe 2024]]",
      "[[Doe 2024#Heading]]",
      "[[Doe 2024#^block]]",
      "[[Doe 2024#cite:locator=]]",
      "[[ordinary]]",
      "[[missing]]",
    ].join(" ");
    const { draft, index, metadataCache, settings, workspace } =
      await makeHarness(
        { "draft.md": body, "ordinary.md": "" },
        { settings: { "citation.wikilink-citations": true } },
      );
    metadataCache.fileCache.set("draft.md", {
      links: [
        link("Doe 2024", body.indexOf("[[Doe 2024]]")),
        link(
          "Doe 2024#cite:locator=4",
          body.indexOf("[[Doe 2024#cite:locator=4]]"),
        ),
        link(
          "Doe 2024",
          body.indexOf("[[Doe 2024|alias]]"),
          "[[Doe 2024|alias]]",
        ),
        link("Doe 2024", body.indexOf("![[Doe 2024]]"), "![[Doe 2024]]"),
        link("Doe 2024#Heading", body.indexOf("[[Doe 2024#Heading]]")),
        link("Doe 2024#^block", body.indexOf("[[Doe 2024#^block]]")),
        link(
          "Doe 2024#cite:locator=",
          body.indexOf("[[Doe 2024#cite:locator=]]"),
        ),
        link("ordinary", body.indexOf("[[ordinary]]")),
        link("missing", body.indexOf("[[missing]]")),
      ],
    } as CachedMetadata);
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

    workspace.layoutReady();
    await index.whenIndexed();

    expect(snapshots.at(-1)?.groups).toMatchObject([
      {
        path: draft.path,
        occurrences: [
          { kind: "citekey", raw: "doe2024" },
          { kind: "wikilink", raw: "Doe 2024" },
          { kind: "wikilink", raw: "Doe 2024" },
        ],
      },
    ]);
    settings.update({
      "citation.pandoc-citations": false,
      "citation.wikilink-citations": false,
    });
    await yieldToMain();
    expect(snapshots.at(-1)?.groups).toEqual([]);
  });

  it("observes a Literature Note that cites its own Item", async () => {
    const { index, metadataCache, workspace } = await makeHarness({});
    const target = metadataCache.files.get("Doe 2024.md")!;
    metadataCache.change(target, "@doe2024.");
    metadataCache.fileCache.set(target.path, {
      frontmatter: { "zotero-key": KEY_A },
      links: [],
    } as CachedMetadata);
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));

    workspace.layoutReady();
    await index.whenIndexed();

    expect(snapshots.at(-1)?.groups).toMatchObject([
      {
        path: target.path,
        occurrences: [{ kind: "citekey", raw: "doe2024" }],
      },
    ]);
  });

  it("keeps a cross-library wikilink while literal resolution changes library", async () => {
    const body = "@roe2025 [[Roe 2025]]";
    const libraryScope = new LibraryScopeStub([
      personalLibrary(),
      groupLibrary(),
    ]);
    libraryScope.select([personalLibrary()]);
    const { draft, index, metadataCache, workspace } = await makeHarness(
      { "draft.md": body },
      {
        citekeys: [
          {
            itemID: 1,
            libraryID: MY_LIBRARY_ID,
            key: "DOE2024",
            indexedKey: KEY_A,
            citekey: "doe2024",
          },
          {
            itemID: 2,
            libraryID: GROUP_LIBRARY_ID,
            key: "ROE2025",
            indexedKey: KEY_B,
            citekey: "roe2025",
          },
        ],
        libraryScope,
        settings: { "citation.wikilink-citations": true },
      },
    );
    metadataCache.fileCache.set(draft.path, {
      links: [link("Roe 2025", body.indexOf("[["))],
    } as CachedMetadata);
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_B, (snapshot) => snapshots.push(snapshot));
    workspace.layoutReady();
    await index.whenIndexed();

    expect(snapshots.at(-1)?.groups[0]?.occurrences).toMatchObject([
      { kind: "wikilink" },
    ]);

    libraryScope.select([personalLibrary(), groupLibrary()]);
    await yieldToMain();

    expect(snapshots.at(-1)?.groups[0]?.occurrences).toMatchObject([
      { kind: "citekey" },
      { kind: "wikilink" },
    ]);
  });

  it("applies the optional Markdown-note predicate before grouping", async () => {
    const { index, workspace } = await makeHarness({
      "Keep/a.md": "@doe2024.",
      "Skip/b.md": "@doe2024.",
    });
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(
      KEY_A,
      (snapshot) => snapshots.push(snapshot),
      (file) => file.path.startsWith("Keep/"),
    );

    workspace.layoutReady();
    await index.whenIndexed();

    expect(snapshots.at(-1)?.groups.map(({ path }) => path)).toEqual([
      "Keep/a.md",
    ]);
  });

  it("coalesces related edits and publishes only the final changed structure", async () => {
    const { draft, index, metadataCache, workspace } = await makeHarness({
      "draft.md": "@doe2024.",
    });
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
    workspace.layoutReady();
    await index.whenIndexed();
    const before = snapshots.length;

    metadataCache.change(draft, "moved @doe2024.");
    metadataCache.change(draft, "moved again @doe2024.");
    await yieldToMain();

    expect(snapshots).toHaveLength(before + 1);
    expect(
      snapshots.at(-1)?.groups[0]?.occurrences[0]?.position.start.offset,
    ).toBe(12);
  });

  it("refreshes wikilink-only metadata and link-resolution changes", async () => {
    const body = "See [[Doe 2024]].";
    const { draft, index, metadataCache, workspace } = await makeHarness(
      { "draft.md": body },
      { settings: { "citation.wikilink-citations": true } },
    );
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
    workspace.layoutReady();
    await index.whenIndexed();

    metadataCache.change(draft, body, [link("Doe 2024", 4)]);
    await yieldToMain();
    expect(snapshots.at(-1)?.groups).toMatchObject([
      { path: "draft.md", occurrences: [{ kind: "wikilink" }] },
    ]);

    const target = metadataCache.files.get("Doe 2024.md")!;
    metadataCache.fileCache.set("Doe 2024.md", {
      frontmatter: { "zotero-key": KEY_B },
    } as CachedMetadata);
    metadataCache.resolve(target);
    await yieldToMain();
    expect(snapshots.at(-1)?.groups).toEqual([]);
  });

  it("refreshes wikilinks when their target Literature Note moves or is deleted", async () => {
    const body = "See [[Doe 2024]].";
    const { draft, index, metadataCache, vault, workspace } = await makeHarness(
      { "draft.md": body },
      { settings: { "citation.wikilink-citations": true } },
    );
    metadataCache.fileCache.set(draft.path, {
      links: [link("Doe 2024", body.indexOf("[["))],
    } as CachedMetadata);
    const target = metadataCache.files.get("Doe 2024.md")!;
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
    workspace.layoutReady();
    await index.whenIndexed();
    expect(snapshots.at(-1)?.groups).toHaveLength(1);

    vault.rename(target, "Literature/Moved.md");
    await yieldToMain();
    expect(snapshots.at(-1)?.groups).toEqual([]);

    vault.rename(target, "Doe 2024.md");
    await yieldToMain();
    expect(snapshots.at(-1)?.groups).toHaveLength(1);

    vault.deleteFile(target);
    await yieldToMain();
    expect(snapshots.at(-1)?.groups).toEqual([]);
  });

  it("refreshes reverse literal membership after a database change", async () => {
    const { citekeys, db, index, workspace } = await makeHarness({
      "draft.md": "@doe2024.",
    });
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
    workspace.layoutReady();
    await index.whenIndexed();
    expect(snapshots.at(-1)?.groups).toHaveLength(1);

    citekeys.rows = [
      {
        itemID: 1,
        libraryID: MY_LIBRARY_ID,
        key: "DOE2024",
        indexedKey: KEY_B,
        citekey: "doe2024",
      },
    ];
    db.changed();
    await yieldToMain();

    expect(snapshots.at(-1)?.groups).toEqual([]);
  });

  it("keeps a superseded backfill read out of reverse publications", async () => {
    const { draft, index, metadataCache, vault, workspace } = await makeHarness(
      { "draft.md": "@doe2024." },
    );
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
    workspace.layoutReady();
    await index.whenIndexed();
    const release = vault.hold(draft.path);

    await index.reset();
    await yieldToMain();
    expect(vault.reads.at(-1)).toBe(draft.path);
    metadataCache.change(draft, "@roe2025.");
    await yieldToMain();
    expect(snapshots.at(-1)?.groups).toEqual([]);

    release();
    await index.whenIndexed();
    expect(snapshots.at(-1)?.groups).toEqual([]);
  });

  it("recomputes reverse facts without body reads or reverse writes", async () => {
    const { index, metadataCache, store, vault, workspace } = await makeHarness(
      { "draft.md": "@doe2024." },
    );
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
    workspace.layoutReady();
    await index.whenIndexed();
    vault.reads.length = 0;
    store.writes.length = 0;

    metadataCache.resolve(metadataCache.files.get("Doe 2024.md")!);
    await yieldToMain();

    expect(vault.reads).toEqual([]);
    expect(store.writes).toEqual([]);
    expect(snapshots.at(-1)?.groups).toHaveLength(1);
  });

  it("adds, moves, and removes citing notes as vault facts change", async () => {
    const { index, metadataCache, vault, workspace } = await makeHarness({});
    const snapshots: CitedBySnapshot[] = [];
    index.observeCitedBy(KEY_A, (snapshot) => snapshots.push(snapshot));
    workspace.layoutReady();
    await index.whenIndexed();

    const created = new TFile();
    created.path = "created.md";
    created.name = "created.md";
    created.basename = "created";
    created.extension = "md";
    created.stat = { ctime: 0, mtime: 0, size: 0 };
    metadataCache.change(created, "@doe2024.");
    await yieldToMain();
    expect(snapshots.at(-1)?.groups.map(({ path }) => path)).toEqual([
      "created.md",
    ]);

    vault.rename(created, "Folder/moved.md");
    await yieldToMain();
    expect(snapshots.at(-1)?.groups.map(({ path }) => path)).toEqual([
      "Folder/moved.md",
    ]);

    vault.deleteFile(created);
    await yieldToMain();
    expect(snapshots.at(-1)?.groups).toEqual([]);
  });

  it("suppresses identical snapshots and isolates observer failures", async () => {
    const { draft, index, metadataCache, workspace } = await makeHarness({
      "draft.md": "@doe2024.",
    });
    let publications = 0;
    index.observeCitedBy(KEY_A, () => {
      throw new Error("observer failed");
    });
    index.observeCitedBy(KEY_A, () => publications++);
    workspace.layoutReady();
    await index.whenIndexed();
    const before = publications;

    metadataCache.change(draft, "@doe2024.");
    await yieldToMain();

    expect(publications).toBe(before);
  });

  it("does not publish an observation after its disposer runs", async () => {
    const { index, workspace, metadataCache, draft } = await makeHarness({
      "draft.md": "@doe2024.",
    });
    let publications = 0;
    const stop = index.observeCitedBy(KEY_A, () => publications++);
    workspace.layoutReady();
    await index.whenIndexed();
    expect(publications).toBe(3);

    metadataCache.change(draft, "@roe2025.");
    stop();
    await yieldToMain();
    expect(publications).toBe(3);
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

describe("CitationIndex documentOmittedSyntaxes", () => {
  it("reports no omitted syntax for a document with no citations at all", async () => {
    const { draft, index } = await makeHarness({ "draft.md": "Plain text." });

    expect(await index.documentOmittedSyntaxes(draft)).toEqual([]);
  });

  it("reports citekey when Pandoc citations is off and the document scans one", async () => {
    const { draft, index } = await makeHarness(
      { "draft.md": "As @doe2024 wrote." },
      { settings: { "citation.pandoc-citations": false } },
    );

    expect(await index.documentOmittedSyntaxes(draft)).toEqual(["citekey"]);
  });

  it("reports wikilink when Wikilink citations is off and an eligible link resolves", async () => {
    const { draft, index, metadataCache } = await makeHarness({
      "draft.md": "See [[Doe 2024]].",
    });
    metadataCache.fileCache.set("draft.md", {
      links: [link("Doe 2024", 4)],
    } as CachedMetadata);

    expect(await index.documentOmittedSyntaxes(draft)).toEqual(["wikilink"]);
  });

  it("reports wikilink when a document holds included citekey citations and an excluded wikilink that resolves", async () => {
    const body = "As @doe2024 wrote. See [[Roe 2025]] too.";
    const { draft, index, metadataCache } = await makeHarness({
      "draft.md": body,
    });
    metadataCache.fileCache.set("draft.md", {
      links: [link("Roe 2025", body.indexOf("[["))],
    } as CachedMetadata);

    expect(await index.documentOmittedSyntaxes(draft)).toEqual(["wikilink"]);
  });

  it("reports wikilink when a malformed Citation Fragment still resolves", async () => {
    const body = "Bad [[Doe 2024#cite:locator=]].";
    const { draft, index, metadataCache } = await makeHarness({
      "draft.md": body,
    });
    metadataCache.fileCache.set("draft.md", {
      links: [link("Doe 2024#cite:locator=", body.indexOf("[["))],
    } as CachedMetadata);

    expect(await index.documentOmittedSyntaxes(draft)).toEqual(["wikilink"]);
  });

  it("reports no omitted syntax when the only wikilink resolves to no Item", async () => {
    const { draft, index, metadataCache } = await makeHarness({
      "draft.md": "See [[ordinary]].",
      "ordinary.md": "",
    });
    metadataCache.fileCache.set("draft.md", {
      links: [link("ordinary", 4)],
    } as CachedMetadata);

    expect(await index.documentOmittedSyntaxes(draft)).toEqual([]);
  });

  it("reports both syntaxes when both are excluded and both hold occurrences", async () => {
    const body = "See @doe2024 and [[Roe 2025]].";
    const { draft, index, metadataCache } = await makeHarness(
      { "draft.md": body },
      {
        settings: {
          "citation.pandoc-citations": false,
          "citation.wikilink-citations": false,
        },
      },
    );
    metadataCache.fileCache.set("draft.md", {
      links: [link("Roe 2025", body.indexOf("[["))],
    } as CachedMetadata);

    expect(await index.documentOmittedSyntaxes(draft)).toEqual([
      "citekey",
      "wikilink",
    ]);
  });
});

describe("CitationIndex citedByOmittedSyntaxes", () => {
  it("reports [] when groups is non-empty and holds no excluded occurrence", async () => {
    const { index, workspace } = await makeHarness({
      "draft.md": "@doe2024.",
    });
    workspace.layoutReady();
    await index.whenIndexed();

    expect(index.getCitedBy(KEY_A)).toMatchObject({
      groups: [{ path: "draft.md" }],
    });
    expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual([]);
  });

  it("reports the excluded syntax when a non-empty answer's item also has occurrences of it", async () => {
    const body = "As @doe2024 wrote. See [[Doe 2024]] too.";
    const { index, metadataCache, workspace } = await makeHarness({
      "draft.md": body,
    });
    metadataCache.fileCache.set("draft.md", {
      links: [link("Doe 2024", body.indexOf("[["))],
    } as CachedMetadata);
    workspace.layoutReady();
    await index.whenIndexed();

    // The citekey occurrence still joins the group; the wikilink occurrence
    // of the same item does not, since wikilink citations are excluded by
    // default — the case a short answer must still name.
    expect(index.getCitedBy(KEY_A)).toMatchObject({
      groups: [{ path: "draft.md" }],
    });
    expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual(["wikilink"]);
  });

  it("reports [] when nothing cites the item at all", async () => {
    const { index, workspace } = await makeHarness({
      "draft.md": "@roe2025.",
    });
    workspace.layoutReady();
    await index.whenIndexed();

    expect(index.getCitedBy(KEY_A)).toMatchObject({ groups: [] });
    expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual([]);
  });

  it("reports citekey when it is excluded and its occurrence resolves to the queried item", async () => {
    const { index, workspace } = await makeHarness(
      { "draft.md": "@doe2024." },
      { settings: { "citation.pandoc-citations": false } },
    );
    workspace.layoutReady();
    await index.whenIndexed();

    expect(index.getCitedBy(KEY_A)).toMatchObject({ groups: [] });
    expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual(["citekey"]);
  });

  it("reports wikilink for an eligible occurrence, not for a malformed one", async () => {
    const body = "See [[Doe 2024#cite:locator=]].";
    const { index, metadataCache, workspace } = await makeHarness({
      "draft.md": body,
    });
    metadataCache.fileCache.set("draft.md", {
      links: [link("Doe 2024#cite:locator=", body.indexOf("[["))],
    } as CachedMetadata);
    workspace.layoutReady();
    await index.whenIndexed();

    // The occurrence is malformed, so it never would have joined a group:
    // unlike a references answer, cited-by counts only eligible occurrences.
    expect(index.getCitedBy(KEY_A)).toMatchObject({ groups: [] });
    expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual([]);
  });

  it("scopes the omission to the queried item, not any item an excluded syntax cites", async () => {
    const body = "See [[Roe 2025]].";
    const { index, metadataCache, workspace } = await makeHarness({
      "draft.md": body,
    });
    metadataCache.fileCache.set("draft.md", {
      links: [link("Roe 2025", body.indexOf("[["))],
    } as CachedMetadata);
    workspace.layoutReady();
    await index.whenIndexed();

    // Wikilink citations is off, and an excluded wikilink cites KEY_B — but
    // the queried item is KEY_A, which nobody cites at all.
    expect(index.getCitedBy(KEY_A)).toMatchObject({ groups: [] });
    expect(await index.citedByOmittedSyntaxes(KEY_A)).toEqual([]);
    expect(index.getCitedBy(KEY_B)).toMatchObject({ groups: [] });
    expect(await index.citedByOmittedSyntaxes(KEY_B)).toEqual(["wikilink"]);
  });
});

describe("CitationIndex one-shot reads", () => {
  it("answers the reverse observation as a single read", async () => {
    const { index, workspace } = await makeHarness({
      "review.md": "@doe2024 and @roe2025.",
    });

    workspace.layoutReady();
    await index.whenIndexed();

    expect(index.getCitedBy(KEY_A)).toMatchObject({
      coverage: "complete",
      resolution: "ready",
      groups: [{ path: "review.md", occurrences: [{ raw: "doe2024" }] }],
    });
  });

  it("times out while coverage stays transitional, then settles", async () => {
    const { index, workspace } = await makeHarness({
      "review.md": "@doe2024.",
    });

    await expect(index.waitUntilSettled(5)).resolves.toBe("timeout");

    workspace.layoutReady();
    await expect(index.waitUntilSettled(1_000)).resolves.toBe("settled");
    expect(index.getCitedBy(KEY_A).coverage).toBe("complete");
  });

  it("counts a degraded resolution as settled", async () => {
    const db = new DatabaseStub();
    db.state = "degraded";
    const { index, workspace } = await makeHarness(
      { "review.md": "@doe2024." },
      { db, notes: false },
    );

    workspace.layoutReady();
    await expect(index.waitUntilSettled(1_000)).resolves.toBe("settled");
    expect(index.getCitedBy(KEY_A).resolution).toBe("degraded");
  });
});

describe("CitationIndex ambiguous citation keys", () => {
  /** An Indexed Key of the group Library the multi-Library fixtures use. */
  const GROUP_KEY = "GRP12345g7";

  const myLibraryRow = {
    itemID: 1,
    libraryID: MY_LIBRARY_ID,
    key: "DOE2024",
    indexedKey: KEY_A,
    citekey: "doe2024",
  };
  /** A second Item of My Library answering to the same citekey. */
  const sameLibraryTwin = {
    itemID: 2,
    libraryID: MY_LIBRARY_ID,
    key: "ROE2025",
    indexedKey: KEY_B,
    citekey: "doe2024",
  };
  /** An Item of the group Library answering to the same citekey. A lower
   *  `itemID` than its My Library twin, so Library order alone can order them. */
  const groupTwin = {
    itemID: 1,
    libraryID: GROUP_LIBRARY_ID,
    key: "GRP12345",
    indexedKey: GROUP_KEY,
    citekey: "doe2024",
  };

  function bothLibraries(): LibraryScopeStub {
    return new LibraryScopeStub([personalLibrary(), groupLibrary()]);
  }

  it("classifies two Items of one Library under the same key as ambiguous", async () => {
    const { index } = await makeHarness(
      {},
      { notes: false, citekeys: [myLibraryRow, sameLibraryTwin] },
    );

    expect(index.resolveCitekey("doe2024")).toEqual({
      kind: "ambiguous",
      candidates: [
        {
          itemID: 1,
          libraryID: MY_LIBRARY_ID,
          key: "DOE2024",
          indexedKey: KEY_A,
        },
        {
          itemID: 2,
          libraryID: MY_LIBRARY_ID,
          key: "ROE2025",
          indexedKey: KEY_B,
        },
      ],
    });
  });

  it("classifies Items of two Libraries as ambiguous, in canonical Library order", async () => {
    const { index } = await makeHarness(
      {},
      {
        notes: false,
        citekeys: [groupTwin, myLibraryRow],
        libraryScope: bothLibraries(),
      },
    );

    const resolved = index.resolveCitekey("doe2024");
    expect(resolved.kind).toBe("ambiguous");
    expect(
      resolved.kind === "ambiguous"
        ? resolved.candidates.map((candidate) => candidate.indexedKey)
        : [],
    ).toEqual([KEY_A, GROUP_KEY]);
  });

  it("narrows an ambiguous key to unique when Library Scope drops a candidate", async () => {
    const libraryScope = bothLibraries();
    const { index } = await makeHarness(
      {},
      { notes: false, citekeys: [myLibraryRow, groupTwin], libraryScope },
    );
    expect(index.resolveCitekey("doe2024").kind).toBe("ambiguous");

    libraryScope.select([personalLibrary()]);
    await index.whenResolved();
    await yieldToMain();

    expect(index.resolveCitekey("doe2024")).toMatchObject({
      kind: "unique",
      item: { indexedKey: KEY_A },
    });
  });

  it("resolves an exact Indexed Key of a Library outside the scope", async () => {
    const libraryScope = bothLibraries();
    libraryScope.select([personalLibrary()]);
    const { index } = await makeHarness(
      {},
      { notes: false, citekeys: [myLibraryRow, groupTwin], libraryScope },
    );

    expect(index.resolveCitekey("doe2024")).toMatchObject({ kind: "unique" });
    expect(index.citekeyOf(GROUP_KEY)).toBe("doe2024");
  });

  it("emits one change for a candidate order change and none for an equal refresh", async () => {
    const { index, citekeys, db } = await makeHarness(
      {},
      { notes: false, citekeys: [myLibraryRow, sameLibraryTwin] },
    );
    let notified = 0;
    index.on("resolution-changed", () => notified++);

    db.changed();
    await index.whenResolved();
    await yieldToMain();
    expect(notified).toBe(0);

    citekeys.rows = [sameLibraryTwin, myLibraryRow];
    db.changed();
    await index.whenResolved();
    await yieldToMain();

    expect(notified).toBe(1);
    expect(index.resolveCitekey("doe2024")).toMatchObject({
      kind: "ambiguous",
      candidates: [{ indexedKey: KEY_B }, { indexedKey: KEY_A }],
    });
  });

  it("keeps an ambiguous literal citation under its own Citation Key", async () => {
    const { draft, index } = await makeHarness(
      { "draft.md": "As @doe2024 wrote." },
      { notes: false, citekeys: [myLibraryRow, sameLibraryTwin] },
    );

    expect(await citationsOf(index, draft)).toMatchObject([
      { indexedKey: null, linkpath: null, refNumber: 1 },
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
