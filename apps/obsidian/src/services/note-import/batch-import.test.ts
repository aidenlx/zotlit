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
  USER_LIBRARY_ID,
  type ChildNote,
  type Note,
} from "@zotlit/db";
import { Temporal } from "@zotlit/shared/temporal";

import { confirm } from "@/lib/confirm";
import { defaults, type Settings } from "@/services/settings/schema";
import {
  type BatchClassifyControls,
  type BatchModalOptions,
  type BatchRunControls,
} from "@/views/batch-modal";

import {
  batchImportNotice,
  childImportToast,
  reimportNoteByKey,
  runBatchImport,
  runChildImportByKey,
  type NoteImportContext,
} from "./batch-import";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    getNoteRefsByItemIDs: vi.fn(),
    getChildNotesByParentIDs: vi.fn(),
    getItemDisplayRefByID: vi.fn(),
    getNoteByItemID: vi.fn(),
    getItemsByKey: vi.fn(),
    getNoteByKey: vi.fn(),
  };
});

vi.mock("@/lib/confirm", () => ({ confirm: vi.fn() }));

/** Captured options of every {@link BatchModal} the runner opened. */
const openedModals: BatchModalOptions[] = [];

vi.mock("@/views/batch-modal", async () => {
  const run = await vi.importActual<typeof import("@/views/batch-modal/run")>(
    "@/views/batch-modal/run",
  );
  class FlatManifest {
    constructor(readonly options: unknown) {}
  }
  class HierarchyManifest {
    constructor(readonly options: unknown) {}
  }
  class BatchModal {
    constructor(
      _app: unknown,
      readonly options: BatchModalOptions,
    ) {
      openedModals.push(options);
    }
    open(): void {}
  }
  return { ...run, BatchModal, FlatManifest, HierarchyManifest };
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
    dbState?: string;
    importNoteResult?: "created" | "overwritten" | "skipped";
    templateReady?: Promise<void>;
    existing?: TFile[];
  } = {},
): {
  deps: NoteImportContext;
  importNote: ReturnType<typeof vi.fn>;
} {
  const client = {};
  const importNote = vi.fn(
    async () => options.importNoteResult ?? ("created" as const),
  );
  const deps = {
    db: {
      state: options.dbState ?? "ready",
      client,
      acquireRead: async () => ({ client, [Symbol.dispose]() {} }),
    },
    settings: { loaded: Promise.resolve({ ...defaults, ...settings }) },
    noteImport: { importNote, ensureImportFolder: vi.fn(async () => "/") },
    noteIndex: {
      whenIndexed: async () => {},
      getImportedNoteByNoteKey: () => options.existing ?? [],
    },
    noteFeatures: {
      app: {},
      template: { ready: options.templateReady ?? Promise.resolve() },
    },
  } as unknown as NoteImportContext;
  return { deps, importNote };
}

beforeEach(() => {
  openedModals.length = 0;
  vi.mocked(getNoteRefsByItemIDs).mockReset();
  vi.mocked(getChildNotesByParentIDs).mockReset();
  vi.mocked(getItemDisplayRefByID).mockReset();
  vi.mocked(getNoteByItemID).mockReset();
  vi.mocked(getItemsByKey).mockReset();
  vi.mocked(getNoteByKey).mockReset();
  vi.mocked(confirm).mockReset();
});

describe("runBatchImport routing", () => {
  it("returns db-unavailable when the database is closed", async () => {
    const { deps, importNote } = makeDeps({}, { dbState: "closed" });
    await expect(runBatchImport(deps, "note", [50])).resolves.toEqual({
      outcome: "db-unavailable",
    });
    expect(importNote).not.toHaveBeenCalled();
    expect(openedModals).toHaveLength(0);
  });

  it("returns empty-selection for no ids", async () => {
    const { deps } = makeDeps({});
    await expect(runBatchImport(deps, "note", [])).resolves.toEqual({
      outcome: "empty-selection",
    });
  });

  it("opens a modal for ≥2 note ids instead of importing inline", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50), makeRef(51)]);
    const { deps, importNote } = makeDeps({});

    const result = await runBatchImport(deps, "note", [50, 51]);

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

    const result = await runBatchImport(deps, "child", [1]);

    expect(result).toEqual({ outcome: "batch-modal" });
    expect(openedModals).toHaveLength(1);
  });
});

describe("single note import (mode=note, 1 id)", () => {
  it("imports and reports the created title without a modal", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getNoteByItemID).mockReturnValue(makeNote(50));
    const { deps, importNote } = makeDeps({
      "note.import-annotations-as-template": true,
    });

    const result = await runBatchImport(deps, "note", [50]);

    expect(openedModals).toHaveLength(0);
    expect(importNote).toHaveBeenCalledTimes(1);
    expect(importNote.mock.calls[0]![1]).toMatchObject({
      renderAnnotationParagraph: expect.any(Function),
    });
    expect(result).toEqual({
      outcome: "single",
      write: "created",
      title: "Note 50",
    });
    expect(batchImportNotice(result)).toBe("Imported Note 50.");
  });

  it("leaves the renderer undefined when the setting is off", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getNoteByItemID).mockReturnValue(makeNote(50));
    const { deps, importNote } = makeDeps({
      "note.import-annotations-as-template": false,
    });

    await runBatchImport(deps, "note", [50]);

    expect(
      importNote.mock.calls[0]![1].renderAnnotationParagraph,
    ).toBeUndefined();
  });

  it("reports not-found when the single id does not resolve", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([]);
    const { deps, importNote } = makeDeps({});

    const result = await runBatchImport(deps, "note", [99]);

    expect(result).toEqual({ outcome: "not-found", count: 1 });
    expect(importNote).not.toHaveBeenCalled();
  });

  it("confirms before overwriting an existing imported note", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getNoteByItemID).mockReturnValue(makeNote(50));
    vi.mocked(confirm).mockResolvedValue(true);
    const target = makeFile("Imported/Note 50.md");
    const { deps, importNote } = makeDeps(
      {},
      { existing: [target], importNoteResult: "overwritten" },
    );

    const result = await runBatchImport(deps, "note", [50]);

    expect(confirm).toHaveBeenCalledTimes(1);
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
    vi.mocked(confirm).mockResolvedValue(false);
    const { deps, importNote } = makeDeps(
      {},
      { existing: [makeFile("Imported/Note 50.md")] },
    );

    const result = await runBatchImport(deps, "note", [50]);

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

    const pending = runBatchImport(deps, "note", [50]);
    await Promise.resolve();
    await Promise.resolve();

    expect(importNote).not.toHaveBeenCalled();
    templateReady.resolve();
    await pending;
    expect(importNote).toHaveBeenCalledTimes(1);
  });
});

describe("note-mode modal classify + run", () => {
  it("threads a renderer to every imported note", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50), makeRef(51)]);
    vi.mocked(getNoteByItemID).mockImplementation((_client, itemID) =>
      makeNote(itemID),
    );
    const { deps, importNote } = makeDeps({
      "note.import-annotations-as-template": true,
    });

    await runBatchImport(deps, "note", [50, 51]);
    await driveLastModal();

    expect(importNote).toHaveBeenCalledTimes(2);
    for (const call of importNote.mock.calls) {
      expect(call[1]).toMatchObject({
        renderAnnotationParagraph: expect.any(Function),
      });
    }
  });

  it("dedupes itemIDs so one note never mints two mirrors", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getNoteByItemID).mockReturnValue(makeNote(50));
    const { deps, importNote } = makeDeps({});

    await runBatchImport(deps, "note", [50, 50]);
    const { manifest } = await driveLastModal();

    expect(vi.mocked(getNoteRefsByItemIDs).mock.calls[0]![1]).toEqual([50]);
    expect(manifest.options.tasks).toHaveLength(1);
    expect(importNote).toHaveBeenCalledTimes(1);
  });

  it("buckets unresolved ids as not-found while importing the rest", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getNoteByItemID).mockReturnValue(makeNote(50));
    const { deps, importNote } = makeDeps({});

    await runBatchImport(deps, "note", [50, 99]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.notFound).toHaveLength(1);
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

    await runBatchImport(deps, "note", [50, 51]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.tasks[0]).toMatchObject({ kind: "overwrite" });
    expect(importNote.mock.calls[0]![1]).toMatchObject({ targetFile: target });
  });

  it("settles a vanished note as skipped, not failed", async () => {
    vi.mocked(getNoteRefsByItemIDs).mockReturnValue([makeRef(50)]);
    vi.mocked(getNoteByItemID).mockReturnValue(null);
    const { deps, importNote } = makeDeps({});

    await runBatchImport(deps, "note", [50, 51]);
    const { onItemSettled } = await driveLastModal();

    expect(importNote).not.toHaveBeenCalled();
    expect(onItemSettled).toHaveBeenCalledWith({ id: 50, status: "skipped" });
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

    await runBatchImport(deps, "child", [1]);
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

    await runBatchImport(deps, "child", [1]);
    const { manifest } = await driveLastModal();

    expect(manifest.options.parents).toHaveLength(0);
    expect(importNote).not.toHaveBeenCalled();
  });
});

describe("runChildImportByKey", () => {
  it("reports database unavailable instead of not found", async () => {
    const { deps } = makeDeps({}, { dbState: "closed" });

    await expect(
      runChildImportByKey(deps, formatIndexedKey("ABCD2345", null)),
    ).resolves.toEqual({ outcome: "db-unavailable" });
  });

  it("returns null when the indexed key does not resolve to an item", async () => {
    vi.mocked(getItemsByKey).mockReturnValue([]);
    const { deps } = makeDeps({});

    await expect(
      runChildImportByKey(deps, formatIndexedKey("MISSING1", null)),
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

    const result = await runChildImportByKey(
      deps,
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
      runChildImportByKey(deps, formatIndexedKey("ABCD2345", null)),
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
    const { deps } = makeDeps({}, { dbState: "closed" });

    await expect(
      reimportNoteByKey(
        deps,
        formatIndexedKey("ABCD2345", null),
        makeFile("Imported/Clicked.md"),
      ),
    ).resolves.toEqual({ outcome: "db-unavailable" });
  });

  it("returns not-found when the note key does not resolve", async () => {
    vi.mocked(getNoteByKey).mockReturnValue(null);
    const { deps } = makeDeps({});

    await expect(
      reimportNoteByKey(
        deps,
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
      reimportNoteByKey(deps, note.indexedKey, targetFile),
    ).resolves.toEqual({ outcome: "overwritten" });

    expect(importNote.mock.calls[0]![1]).toMatchObject({ targetFile });
  });

  it("preserves a skipped write outcome", async () => {
    const note = makeIndexedNote();
    vi.mocked(getNoteByKey).mockReturnValue(note);
    const { deps } = makeDeps({}, { importNoteResult: "skipped" });

    await expect(
      reimportNoteByKey(deps, note.indexedKey, makeFile("Imported/Clicked.md")),
    ).resolves.toEqual({ outcome: "skipped" });
  });
});
