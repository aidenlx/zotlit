import { type TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatIndexedKey,
  getChildNotesByParentIDs,
  getItemDisplayRefByID,
  getItemsByKey,
  getNoteByItemID,
  getNoteByKey,
  getNoteRefsByItemIDs,
  getTrashedNoteItemIDs,
  USER_LIBRARY_ID,
  type ChildNote,
  type Note,
} from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import { Temporal } from "@zotlit/shared/temporal";

import { defaults, type Settings } from "@/services/settings/schema";
import {
  type BatchClassifyControls,
  type BatchModalOptions,
  type BatchRunControls,
} from "@/views/batch-modal";

import { createBatchImport, type NoteImportDeps } from "./batch-import";
import { batchImportNotice, childImportToast } from "./batch-import-notices";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    getNoteRefsByItemIDs: vi.fn(),
    getTrashedNoteItemIDs: vi.fn(),
    getChildNotesByParentIDs: vi.fn(),
    getItemDisplayRefByID: vi.fn(),
    getNoteByItemID: vi.fn(),
    getItemsByKey: vi.fn(),
    getNoteByKey: vi.fn(),
  };
});

/** Captured options of every batch modal the runner opened via its view port. */
const openedModals: BatchModalOptions[] = [];
/** Stub for the view port's overwrite confirm; controlled per overwrite test. */
const confirmMock = vi.fn();

// Stub only the DOM-bound manifests so classify/run drive the real batch-run
// mechanics (imported from @/services/batch-run, left unmocked) headlessly.
vi.mock("@/views/batch-modal", () => {
  class FlatManifest {
    constructor(readonly options: unknown) {}
  }
  class HierarchyManifest {
    constructor(readonly options: unknown) {}
  }
  return { FlatManifest, HierarchyManifest };
});

function classifyControls(): BatchClassifyControls {
  return { onProgress: vi.fn(), signal: new AbortController().signal };
}

/** Drive the last opened modal through its loading + run phases, returning the
 * built manifest's captured options and the per-item settle spy. */
async function driveLastModal(): Promise<{
  manifest: { options: any };
  onItemSettled: ReturnType<typeof vi.fn>;
}> {
  const opts = openedModals.at(-1);
  if (!opts) throw new Error("no modal was opened");
  const manifest = (await opts.onClassify(classifyControls())) as unknown as {
    options: any;
  };
  const onItemSettled = vi.fn();
  const controls: BatchRunControls = {
    onItemSettled,
    signal: new AbortController().signal,
  };
  await opts.onRun(controls);
  return { manifest, onItemSettled };
}

function makeRef(itemID: number): ChildNote {
  const key = `NOTE${itemID}`;
  return {
    itemID,
    libraryID: USER_LIBRARY_ID,
    groupID: null,
    parentItemID: 1,
    key,
    indexedKey: formatIndexedKey(key, null),
    title: `Note ${itemID}`,
    dateModified: Temporal.Instant.from("2024-02-03T08:30:00Z"),
  };
}

function makeNote(itemID: number): Note {
  return {
    ...makeRef(itemID),
    note: "<h1>Methods</h1><p>body</p>",
    dateAdded: Temporal.Instant.from("2024-01-01T10:00:00Z"),
  };
}

function makeIndexedNote(key = "ABCD2345"): Note {
  return {
    ...makeNote(50),
    key,
    indexedKey: formatIndexedKey(key, null),
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeFile(path: string): TFile {
  return { path } as TFile;
}

function makeDeps(
  settings: Partial<Settings>,
  options: {
    dbState?: "loading" | "ready" | "degraded";
    importNoteResult?: "created" | "overwritten" | "skipped";
    templateReady?: Promise<void>;
    existing?: TFile[];
    /** Per-file frontmatter cache for metadataCache.getFileCache. */
    frontmatter?: Map<TFile, Record<string, unknown>>;
  } = {},
): {
  deps: NoteImportDeps;
  importNote: ReturnType<typeof vi.fn>;
} {
  const client = createClient(":memory:");
  const importNote = vi.fn(
    async () => options.importNoteResult ?? ("created" as const),
  );
  const deps: NoteImportDeps = {
    db: {
      state: options.dbState ?? "ready",
      client,
      acquireRead: async () => ({ client, [Symbol.dispose]() {} }),
    },
    settings: { loaded: Promise.resolve({ ...defaults, ...settings }) },
    noteImport: { importNote },
    noteIndex: {
      whenIndexed: async () => {},
      getImportedNoteByNoteKey: () => options.existing ?? [],
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const fm = options.frontmatter?.get(file);
        return fm ? { frontmatter: fm } : null;
      },
    },
    view: {
      openBatchModal: (opts) => {
        openedModals.push(opts);
      },
      confirm: confirmMock,
    },
    template: { ready: options.templateReady ?? Promise.resolve() },
  };
  return { deps, importNote };
}

beforeEach(() => {
  openedModals.length = 0;
  vi.mocked(getNoteRefsByItemIDs).mockReset();
  vi.mocked(getTrashedNoteItemIDs).mockReset().mockReturnValue(new Set());
  vi.mocked(getChildNotesByParentIDs).mockReset();
  vi.mocked(getItemDisplayRefByID).mockReset();
  vi.mocked(getNoteByItemID).mockReset();
  vi.mocked(getItemsByKey).mockReset();
  vi.mocked(getNoteByKey).mockReset();
  confirmMock.mockReset();
});

describe("runBatchImport routing", () => {
  it("returns db-unavailable when the database is closed", async () => {
    const { deps, importNote } = makeDeps({}, { dbState: "loading" });
    await expect(
      createBatchImport(deps).runBatchImport("note", [50]),
    ).resolves.toEqual({
      outcome: "db-unavailable",
    });
    expect(importNote).not.toHaveBeenCalled();
    expect(openedModals).toHaveLength(0);
  });

  it("returns empty-selection for no ids", async () => {
    const { deps } = makeDeps({});
    await expect(
      createBatchImport(deps).runBatchImport("note", []),
    ).resolves.toEqual({
      outcome: "empty-selection",
    });
  });

  it("opens a modal for ≥2 note ids instead of importing inline", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50), makeRef(51)]);
    const { deps, importNote } = makeDeps({});

    const result = await createBatchImport(deps).runBatchImport(
      "note",
      [50, 51],
    );

    expect(result).toEqual({ outcome: "batch-modal" });
    expect(openedModals).toHaveLength(1);
    expect(importNote).not.toHaveBeenCalled();
  });

  it("opens a modal for child mode", async () => {
    vi.mocked(getChildNotesByParentIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getItemDisplayRefByID).mockReturnValue({
      itemID: 1,
      key: "PARENT01",
      libraryID: USER_LIBRARY_ID,
      groupID: null,
      indexedKey: formatIndexedKey("PARENT01", null),
      title: "Parent",
    });
    const { deps } = makeDeps({});

    const result = await createBatchImport(deps).runBatchImport("child", [1]);

    expect(result).toEqual({ outcome: "batch-modal" });
    expect(openedModals).toHaveLength(1);
  });
});

describe("single note import (mode=note, 1 id)", () => {
  it("imports and reports the created title without a modal", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getNoteByItemID).mockReturnValue(makeNote(50));
    const { deps, importNote } = makeDeps({});

    const result = await createBatchImport(deps).runBatchImport("note", [50]);

    expect(openedModals).toHaveLength(0);
    expect(importNote).toHaveBeenCalledTimes(1);
    // The shared group memo is threaded so a run memoizes group-library lookups.
    expect(importNote.mock.calls[0]![1]).toMatchObject({
      groupIdMemo: expect.any(Map),
    });
    expect(result).toEqual({
      outcome: "single",
      write: "created",
      title: "Note 50",
    });
    expect(batchImportNotice(result)).toBe("Imported Note 50.");
  });

  it("reports not-found when the single id does not resolve", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([]);
    const { deps, importNote } = makeDeps({});

    const result = await createBatchImport(deps).runBatchImport("note", [99]);

    expect(result).toEqual({ outcome: "not-found", count: 1 });
    expect(importNote).not.toHaveBeenCalled();
  });

  it("confirms before overwriting an existing imported note", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getNoteByItemID).mockReturnValue(makeNote(50));
    confirmMock.mockResolvedValue(true);
    const target = makeFile("Imported/Note 50.md");
    const { deps, importNote } = makeDeps(
      {},
      { existing: [target], importNoteResult: "overwritten" },
    );

    const result = await createBatchImport(deps).runBatchImport("note", [50]);

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(importNote.mock.calls[0]![1]).toMatchObject({ targetFile: target });
    expect(result).toEqual({
      outcome: "single",
      write: "overwritten",
      title: "Note 50",
    });
    expect(batchImportNotice(result)).toBe("Updated imported note Note 50.");
  });

  it("cancels when the overwrite confirm is declined", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    confirmMock.mockResolvedValue(false);
    const { deps, importNote } = makeDeps(
      {},
      { existing: [makeFile("Imported/Note 50.md")] },
    );

    const result = await createBatchImport(deps).runBatchImport("note", [50]);

    expect(result).toEqual({ outcome: "cancelled" });
    expect(importNote).not.toHaveBeenCalled();
    expect(batchImportNotice(result)).toBeUndefined();
  });

  it("waits for template readiness before writing", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getNoteByItemID).mockReturnValue(makeNote(50));
    const templateReady = deferred();
    const { deps, importNote } = makeDeps(
      {},
      { templateReady: templateReady.promise },
    );

    const pending = createBatchImport(deps).runBatchImport("note", [50]);
    await Promise.resolve();
    await Promise.resolve();

    expect(importNote).not.toHaveBeenCalled();
    templateReady.resolve();
    await pending;
    expect(importNote).toHaveBeenCalledTimes(1);
  });
});

describe("note-mode modal classify + run", () => {
  it("threads the shared group memo to every imported note", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50), makeRef(51)]);
    vi.mocked(getNoteByItemID).mockImplementation((_client, itemID) =>
      makeNote(itemID),
    );
    const { deps, importNote } = makeDeps({});

    await createBatchImport(deps).runBatchImport("note", [50, 51]);
    await driveLastModal();

    expect(importNote).toHaveBeenCalledTimes(2);
    // Both writes share one memo instance, so group-library lookups memoize.
    const memo = importNote.mock.calls[0]![1].groupIdMemo;
    expect(memo).toBeInstanceOf(Map);
    for (const call of importNote.mock.calls) {
      expect(call[1].groupIdMemo).toBe(memo);
    }
  });

  it("dedupes itemIDs so one note never mints two mirrors", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getNoteByItemID).mockReturnValue(makeNote(50));
    const { deps, importNote } = makeDeps({});

    await createBatchImport(deps).runBatchImport("note", [50, 50]);
    const { manifest } = await driveLastModal();

    expect(vi.mocked(getNoteRefsByItemIDs).mock.calls[0]![1]).toEqual([50]);
    expect(manifest.options.tasks).toHaveLength(1);
    expect(importNote).toHaveBeenCalledTimes(1);
  });

  it("buckets unresolved ids as not-found while importing the rest", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getNoteByItemID).mockReturnValue(makeNote(50));
    const { deps, importNote } = makeDeps({});

    await createBatchImport(deps).runBatchImport("note", [50, 99]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.notFound).toHaveLength(1);
    expect(manifest.options.tasks).toHaveLength(1);
    expect(importNote).toHaveBeenCalledTimes(1);
  });

  it("labels a trashed note distinctly from a genuine non-note id", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getNoteByItemID).mockReturnValue(makeNote(50));
    // 60 is a note that's in Zotero's trash; 99 isn't a note at all.
    vi.mocked(getTrashedNoteItemIDs).mockReturnValue(new Set([60]));
    const { deps, importNote } = makeDeps({});

    await createBatchImport(deps).runBatchImport("note", [50, 60, 99]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.notFound).toEqual(
      expect.arrayContaining([
        { itemID: 60, label: "Item 60 (in trash)" },
        { itemID: 99, label: "Item 99 (not a note)" },
      ]),
    );
    expect(manifest.options.tasks).toHaveLength(1);
    expect(importNote).toHaveBeenCalledTimes(1);
  });

  it("classifies an existing mirror as an overwrite with its target file", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getNoteByItemID).mockReturnValue(makeNote(50));
    const target = makeFile("Imported/Note 50.md");
    const { deps, importNote } = makeDeps(
      {},
      { existing: [target], importNoteResult: "overwritten" },
    );

    await createBatchImport(deps).runBatchImport("note", [50, 51]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.tasks[0]).toMatchObject({ kind: "overwrite" });
    expect(importNote.mock.calls[0]![1]).toMatchObject({ targetFile: target });
  });

  it("settles a vanished note as skipped, not failed", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getNoteByItemID).mockReturnValue(null);
    const { deps, importNote } = makeDeps({});

    await createBatchImport(deps).runBatchImport("note", [50, 51]);
    const { onItemSettled } = await driveLastModal();

    expect(importNote).not.toHaveBeenCalled();
    expect(onItemSettled).toHaveBeenCalledWith({ id: 50, status: "skipped" });
  });
});

describe("up-to-date classification", () => {
  it("classifies a note as up-to-date when zotero-lastmod matches", async () => {
    const ref50 = makeRef(50);
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([ref50, makeRef(51)]);
    vi.mocked(getNoteByItemID).mockImplementation((_client, itemID) =>
      makeNote(itemID),
    );
    const target = makeFile("Imported/Note 50.md");
    const { deps, importNote } = makeDeps(
      {},
      {
        frontmatter: new Map([
          [target, { "zotero-lastmod": "2024-02-03T08:30:00Z" }],
        ]),
      },
    );
    deps.noteIndex.getImportedNoteByNoteKey = (key) =>
      key === ref50.indexedKey ? [target] : [];

    await createBatchImport(deps).runBatchImport("note", [50, 51]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.tasks).toHaveLength(1);
    expect(manifest.options.tasks[0]).toMatchObject({ kind: "create" });
    expect(manifest.options.upToDate).toHaveLength(1);
    expect(manifest.options.upToDate[0]).toMatchObject({ label: "Note 50" });
    expect(importNote).toHaveBeenCalledTimes(1);
  });

  it("classifies as overwrite when zotero-lastmod is missing (self-healing)", async () => {
    const ref50 = makeRef(50);
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([ref50, makeRef(51)]);
    vi.mocked(getNoteByItemID).mockImplementation((_client, itemID) =>
      makeNote(itemID),
    );
    const target = makeFile("Imported/Note 50.md");
    const { deps, importNote } = makeDeps(
      {},
      { importNoteResult: "overwritten" },
    );
    deps.noteIndex.getImportedNoteByNoteKey = (key) =>
      key === ref50.indexedKey ? [target] : [];

    await createBatchImport(deps).runBatchImport("note", [50, 51]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.tasks[0]).toMatchObject({ kind: "overwrite" });
    expect(manifest.options.upToDate).toHaveLength(0);
    expect(importNote).toHaveBeenCalledTimes(2);
  });

  it("classifies as overwrite when zotero-lastmod is older than dateModified", async () => {
    const ref50 = makeRef(50);
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([ref50, makeRef(51)]);
    vi.mocked(getNoteByItemID).mockImplementation((_client, itemID) =>
      makeNote(itemID),
    );
    const target = makeFile("Imported/Note 50.md");
    const { deps, importNote } = makeDeps(
      {},
      {
        importNoteResult: "overwritten",
        frontmatter: new Map([
          [target, { "zotero-lastmod": "2024-02-03T08:29:00Z" }],
        ]),
      },
    );
    deps.noteIndex.getImportedNoteByNoteKey = (key) =>
      key === ref50.indexedKey ? [target] : [];

    await createBatchImport(deps).runBatchImport("note", [50, 51]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.tasks[0]).toMatchObject({ kind: "overwrite" });
    expect(manifest.options.upToDate).toHaveLength(0);
    expect(importNote).toHaveBeenCalledTimes(2);
  });

  it("classifies as overwrite when zotero-lastmod is newer than dateModified", async () => {
    const ref50 = makeRef(50);
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([ref50, makeRef(51)]);
    vi.mocked(getNoteByItemID).mockImplementation((_client, itemID) =>
      makeNote(itemID),
    );
    const target = makeFile("Imported/Note 50.md");
    const { deps, importNote } = makeDeps(
      {},
      {
        importNoteResult: "overwritten",
        frontmatter: new Map([
          [target, { "zotero-lastmod": "2024-02-03T08:31:00Z" }],
        ]),
      },
    );
    deps.noteIndex.getImportedNoteByNoteKey = (key) =>
      key === ref50.indexedKey ? [target] : [];

    await createBatchImport(deps).runBatchImport("note", [50, 51]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.tasks[0]).toMatchObject({ kind: "overwrite" });
    expect(manifest.options.upToDate).toHaveLength(0);
    expect(importNote).toHaveBeenCalledTimes(2);
  });

  it("classifies as create when no existing file exists", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50), makeRef(51)]);
    vi.mocked(getNoteByItemID).mockImplementation((_client, itemID) =>
      makeNote(itemID),
    );
    const { deps, importNote } = makeDeps({});

    await createBatchImport(deps).runBatchImport("note", [50, 51]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.tasks).toHaveLength(2);
    expect(manifest.options.tasks[0]).toMatchObject({ kind: "create" });
    expect(manifest.options.tasks[1]).toMatchObject({ kind: "create" });
    expect(manifest.options.upToDate).toHaveLength(0);
    expect(importNote).toHaveBeenCalledTimes(2);
  });
});

describe("child-mode modal classify", () => {
  it("groups child notes under their parent display ref", async () => {
    vi.mocked(getChildNotesByParentIDs).mockReturnValue([
      makeRef(50),
      makeRef(51),
    ]);
    vi.mocked(getItemDisplayRefByID).mockReturnValue({
      itemID: 1,
      key: "PARENT01",
      libraryID: USER_LIBRARY_ID,
      groupID: null,
      indexedKey: formatIndexedKey("PARENT01", null),
      title: "Parent paper",
    });
    vi.mocked(getNoteByItemID).mockImplementation((_client, itemID) =>
      makeNote(itemID),
    );
    const { deps, importNote } = makeDeps({});

    await createBatchImport(deps).runBatchImport("child", [1]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.parents).toHaveLength(1);
    expect(manifest.options.parents[0]).toMatchObject({
      label: "Parent paper",
    });
    expect(manifest.options.parents[0].children).toHaveLength(2);
    expect(importNote).toHaveBeenCalledTimes(2);
  });

  it("builds an empty tree when no child notes exist", async () => {
    vi.mocked(getChildNotesByParentIDs).mockReturnValue([]);
    const { deps, importNote } = makeDeps({});

    await createBatchImport(deps).runBatchImport("child", [1]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.parents).toHaveLength(0);
    expect(importNote).not.toHaveBeenCalled();
  });
});

describe("runChildImportByKey", () => {
  it("reports database unavailable instead of not found", async () => {
    const { deps } = makeDeps({}, { dbState: "loading" });

    await expect(
      createBatchImport(deps).runChildImportByKey(
        formatIndexedKey("ABCD2345", null),
      ),
    ).resolves.toEqual({ outcome: "db-unavailable" });
  });

  it("returns null when the indexed key does not resolve to an item", async () => {
    vi.mocked(getItemsByKey).mockReturnValue([]);
    const { deps } = makeDeps({});

    await expect(
      createBatchImport(deps).runChildImportByKey(
        formatIndexedKey("MISSING1", null),
      ),
    ).resolves.toBeNull();
  });

  it("opens the child-import modal when the key resolves", async () => {
    vi.mocked(getItemsByKey).mockReturnValue([
      { itemID: 7, key: "ABCD2345", libraryID: USER_LIBRARY_ID },
    ] as any);
    vi.mocked(getChildNotesByParentIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getItemDisplayRefByID).mockReturnValue(null);
    vi.mocked(getNoteByItemID).mockReturnValue(makeNote(50));
    const { deps, importNote } = makeDeps({});

    const result = await createBatchImport(deps).runChildImportByKey(
      formatIndexedKey("ABCD2345", null),
    );

    expect(result).toEqual({ outcome: "batch-modal" });
    await driveLastModal();
    expect(importNote).toHaveBeenCalledTimes(1);
  });

  it("returns a rejected promise when synchronous key lookup throws", async () => {
    vi.mocked(getItemsByKey).mockImplementation(() => {
      throw new Error("sqlite read failed");
    });
    const { deps } = makeDeps({});

    await expect(
      createBatchImport(deps).runChildImportByKey(
        formatIndexedKey("ABCD2345", null),
      ),
    ).rejects.toThrow("sqlite read failed");
  });

  it("maps unresolved keys through the child-import toast", () => {
    expect(childImportToast().success(null)).toBe("Zotero item not found.");
    expect(childImportToast().success({ outcome: "db-unavailable" })).toBe(
      "Open the Zotero database to update notes.",
    );
  });
});

describe("reimportNoteByKey", () => {
  it("reports database unavailable instead of not found", async () => {
    const { deps } = makeDeps({}, { dbState: "loading" });

    await expect(
      createBatchImport(deps).reimportNoteByKey(
        formatIndexedKey("ABCD2345", null),
        makeFile("Imported/Clicked.md"),
      ),
    ).resolves.toEqual({ outcome: "db-unavailable" });
  });

  it("returns not-found when the note key does not resolve", async () => {
    vi.mocked(getNoteByKey).mockReturnValue(null);
    const { deps } = makeDeps({});

    await expect(
      createBatchImport(deps).reimportNoteByKey(
        formatIndexedKey("GONE1234", null),
        makeFile("Imported/Clicked.md"),
      ),
    ).resolves.toEqual({ outcome: "not-found" });
  });

  it("passes the clicked file as the overwrite target", async () => {
    const note = makeIndexedNote();
    const targetFile = makeFile("Imported/Clicked.md");
    vi.mocked(getNoteByKey).mockReturnValue(note);
    const { deps, importNote } = makeDeps(
      {},
      { importNoteResult: "overwritten" },
    );

    await expect(
      createBatchImport(deps).reimportNoteByKey(note.indexedKey, targetFile),
    ).resolves.toEqual({ outcome: "overwritten" });

    expect(importNote.mock.calls[0]![1]).toMatchObject({ targetFile });
  });

  it("preserves a skipped write outcome", async () => {
    const note = makeIndexedNote();
    vi.mocked(getNoteByKey).mockReturnValue(note);
    const { deps } = makeDeps({}, { importNoteResult: "skipped" });

    await expect(
      createBatchImport(deps).reimportNoteByKey(
        note.indexedKey,
        makeFile("Imported/Clicked.md"),
      ),
    ).resolves.toEqual({ outcome: "skipped" });
  });
});
