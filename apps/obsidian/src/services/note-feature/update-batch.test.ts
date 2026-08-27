import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCollectionIDByKey,
  getIndexedItemIDsByCollection,
  getIndexedItemIDsByLibrary,
  getItemDisplayRefByID,
  getItemRefByID,
  getLibraries,
  getLibraryByGroupID,
  USER_LIBRARY_ID,
} from "@zotlit/db";
import type { Library } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";

import type {
  AvailableLibrary,
  LibrarySelector,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";
import { selectorOf } from "@/services/library-scope/scope";
import { defaults } from "@/services/settings/schema";
import type { BatchModalOptions, FlatGroupDef } from "@/views/batch-modal";

import type { CreateNoteResult } from "./operations";
import {
  batchCreateOutcome,
  BatchCreateRefusedError,
  runBatchUpdateAll,
} from "./update-batch";
import type { BatchUpdateResult } from "./update-batch";
import type { SingleUpdateDeps } from "./update-single";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    getLibraries: vi.fn(),
    getLibraryByGroupID: vi.fn(),
    getItemDisplayRefByID: vi.fn(),
    getItemRefByID: vi.fn(),
    getCollectionIDByKey: vi.fn(),
    getIndexedItemIDsByLibrary: vi.fn(),
    getIndexedItemIDsByCollection: vi.fn(),
  };
});

/** Captured options of every batch modal the runner opened. */
const openedModals: BatchModalOptions[] = [];

// Stub the DOM-bound modal so the runner's scope resolution can be driven
// headlessly; classification runs inside the modal, which never opens here.
vi.mock("@/views/batch-modal", () => {
  class BatchModal {
    constructor(
      _app: unknown,
      readonly options: BatchModalOptions,
    ) {
      openedModals.push(options);
    }
    open(): void {}
  }
  class FlatManifest {
    constructor(readonly options: any) {}
    get counts() {
      return {
        actionable: this.options.tasks.length,
        notFound: this.options.notFound.length,
      };
    }
  }
  return { BatchModal, FlatManifest };
});

const COLLECTION = "ABCD2345";

const PERSONAL_LIBRARY: Library = {
  libraryID: USER_LIBRARY_ID,
  type: "user",
  groupID: null,
  name: null,
};

/** A group whose local id sorts before the personal library's own row order. */
const GROUP_LIBRARY: Library = {
  libraryID: 12,
  type: "group",
  groupID: 7,
  name: "Reading group",
};

function available(library: Library): AvailableLibrary {
  return {
    selector: selectorOf(library)!,
    libraryID: library.libraryID,
    name: library.name,
  };
}

function scopeOf(
  libraries: readonly Library[],
  unavailable: readonly LibrarySelector[] = [],
): ResolvedLibraryScope {
  return {
    mode: "selected",
    invalid: false,
    available: libraries.map(available),
    unavailable,
  };
}

let currentScope: ResolvedLibraryScope = scopeOf([PERSONAL_LIBRARY]);

function makeDeps(dbState: "loading" | "ready" = "ready"): SingleUpdateDeps {
  const client = createClient(":memory:");
  return {
    app: {} as SingleUpdateDeps["app"],
    db: {
      state: dbState,
      client,
      acquireRead: async () => ({ client, [Symbol.dispose]() {} }),
    },
    settings: { loaded: Promise.resolve({ ...defaults }) },
    libraryScope: { resolveWith: () => currentScope },
    noteFeature: {} as SingleUpdateDeps["noteFeature"],
    noteIndex: {
      whenIndexed: async () => {},
      getNotesByItemKey: () => [],
    },
  } as unknown as SingleUpdateDeps;
}

/** Drive the last opened modal's loading phase and return its manifest options. */
async function classifyLastModal(): Promise<{
  tasks: { id: number; kind: string }[];
  groups: FlatGroupDef[];
  intro: string;
}> {
  const opts = openedModals.at(-1);
  if (!opts) throw new Error("no modal was opened");
  const manifest = (await opts.onClassify({
    onProgress: vi.fn(),
    signal: new AbortController().signal,
  })) as unknown as { options: any };
  return {
    tasks: manifest.options.tasks,
    groups: manifest.options.groups,
    intro: opts.text.confirmIntro({
      actionable: manifest.options.tasks.length,
      notFound: manifest.options.notFound.length,
    }),
  };
}

/** Every classified id resolves to a live item of `libraryID`. */
function itemsIn(byLibrary: ReadonlyMap<number, number>): void {
  vi.mocked(getItemDisplayRefByID).mockImplementation((_client, itemID) => {
    const libraryID = byLibrary.get(itemID);
    if (libraryID === undefined) return null;
    return {
      itemID,
      key: `ITEM${itemID}`,
      libraryID,
      groupID: libraryID === USER_LIBRARY_ID ? null : 7,
      indexedKey: `ITEM${itemID}`,
      title: `Item ${itemID}`,
    };
  });
}

beforeEach(() => {
  openedModals.length = 0;
  currentScope = scopeOf([PERSONAL_LIBRARY]);
  vi.mocked(getLibraries)
    .mockReset()
    .mockReturnValue([PERSONAL_LIBRARY, GROUP_LIBRARY]);
  vi.mocked(getLibraryByGroupID)
    .mockReset()
    .mockImplementation((_client, groupID) =>
      groupID === GROUP_LIBRARY.groupID ? GROUP_LIBRARY : null,
    );
  vi.mocked(getItemDisplayRefByID).mockReset().mockReturnValue(null);
  vi.mocked(getItemRefByID).mockReset().mockReturnValue(null);
  vi.mocked(getCollectionIDByKey).mockReset().mockReturnValue(100);
  vi.mocked(getIndexedItemIDsByLibrary).mockReset().mockReturnValue([]);
  vi.mocked(getIndexedItemIDsByCollection).mockReset().mockReturnValue([]);
});

describe("batchCreateOutcome", () => {
  it("preserves a create refusal as a failed-row error with its diagnostic", () => {
    const refusal: Extract<CreateNoteResult, { outcome: "refused" }> = {
      outcome: "refused",
      diagnostic: {
        code: "duplicate-literature-notes",
        hint: "Resolve the duplicate Literature Notes, then run create again.",
        indexedKey: "ABCD1234",
        paths: ["Literature/Newer.md", "Archive/Older.md"],
      },
    };

    try {
      batchCreateOutcome(refusal);
      throw new Error("Expected the batch create to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(BatchCreateRefusedError);
      expect(error).toMatchObject({
        message:
          "Multiple literature notes use this Zotero key: Literature/Newer.md, Archive/Older.md; resolve the duplicates before you create another note.",
        diagnostic: refusal.diagnostic,
      });
    }
  });
});

describe("runBatchUpdateAll", () => {
  it("returns db-unavailable when the database is closed", async () => {
    await expect(runBatchUpdateAll(makeDeps("loading"))).resolves.toEqual({
      outcome: "db-unavailable",
    } satisfies BatchUpdateResult);
    expect(getIndexedItemIDsByLibrary).not.toHaveBeenCalled();
  });

  it("reports an empty library scope before querying any item", async () => {
    currentScope = scopeOf([], [{ type: "group", groupID: 7 }]);

    await expect(runBatchUpdateAll(makeDeps())).resolves.toEqual({
      outcome: "no-library-in-scope",
    });
    expect(getIndexedItemIDsByLibrary).not.toHaveBeenCalled();
    expect(openedModals).toHaveLength(0);
  });

  it("updates every item of every library in scope, in canonical order", async () => {
    currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
    vi.mocked(getIndexedItemIDsByLibrary).mockImplementation(
      (_client, libraryID) => (libraryID === USER_LIBRARY_ID ? [1, 2] : [3]),
    );

    await expect(runBatchUpdateAll(makeDeps())).resolves.toEqual({
      outcome: "batch-modal",
    });
    expect(
      vi.mocked(getIndexedItemIDsByLibrary).mock.calls.map(([, id]) => id),
    ).toEqual([USER_LIBRARY_ID, GROUP_LIBRARY.libraryID]);
    expect(openedModals[0]?.total).toBe(3);
  });

  it("runs the available subset and states the unavailable library count", async () => {
    currentScope = scopeOf([PERSONAL_LIBRARY], [{ type: "group", groupID: 9 }]);
    vi.mocked(getIndexedItemIDsByLibrary).mockReturnValue([1, 2]);
    itemsIn(
      new Map([
        [1, USER_LIBRARY_ID],
        [2, USER_LIBRARY_ID],
      ]),
    );

    await runBatchUpdateAll(makeDeps());

    const { intro } = await classifyLastModal();
    expect(intro).toContain("1 selected library is unavailable.");
  });

  it("keeps action-only headings while one library contributes", async () => {
    currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
    vi.mocked(getIndexedItemIDsByLibrary).mockImplementation(
      (_client, libraryID) => (libraryID === USER_LIBRARY_ID ? [1, 2] : []),
    );
    itemsIn(
      new Map([
        [1, USER_LIBRARY_ID],
        [2, USER_LIBRARY_ID],
      ]),
    );

    await runBatchUpdateAll(makeDeps());

    const { groups, intro } = await classifyLastModal();
    expect(groups.map((group) => group.header({ count: 2 }))).toEqual([
      "Update (2)",
      "Create (2)",
    ]);
    expect(intro).not.toContain("unavailable");
  });

  it("groups rows by library and action when several libraries contribute", async () => {
    currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
    vi.mocked(getIndexedItemIDsByLibrary).mockImplementation(
      (_client, libraryID) => (libraryID === USER_LIBRARY_ID ? [1] : [3]),
    );
    itemsIn(
      new Map([
        [1, USER_LIBRARY_ID],
        [3, GROUP_LIBRARY.libraryID],
      ]),
    );

    await runBatchUpdateAll(makeDeps());

    const { tasks, groups } = await classifyLastModal();
    expect(tasks).toEqual([
      expect.objectContaining({ id: 1, kind: "1:create" }),
      expect.objectContaining({ id: 3, kind: "12:create" }),
    ]);
    expect(groups.map((group) => group.header({ count: 1 }))).toEqual([
      "My Library · Update (1)",
      "My Library · Create (1)",
      "Reading group · Update (1)",
      "Reading group · Create (1)",
    ]);
  });

  it("routes a one-item multi-library expansion to the single-item path", async () => {
    currentScope = scopeOf([PERSONAL_LIBRARY, GROUP_LIBRARY]);
    vi.mocked(getIndexedItemIDsByLibrary).mockImplementation(
      (_client, libraryID) => (libraryID === USER_LIBRARY_ID ? [] : [3]),
    );

    await expect(runBatchUpdateAll(makeDeps())).resolves.toEqual({
      outcome: "not-found",
    });
    expect(openedModals).toHaveLength(0);
  });

  describe("exact target", () => {
    it("resolves the named group outside library scope", async () => {
      currentScope = scopeOf([PERSONAL_LIBRARY]);
      vi.mocked(getIndexedItemIDsByLibrary).mockReturnValue([1, 2]);

      await expect(
        runBatchUpdateAll(makeDeps(), { groupID: 7 }),
      ).resolves.toEqual({ outcome: "batch-modal" });
      expect(getIndexedItemIDsByLibrary).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        GROUP_LIBRARY.libraryID,
      );
    });

    it("resolves an absent library parameter to My Library", async () => {
      currentScope = scopeOf([GROUP_LIBRARY]);
      vi.mocked(getIndexedItemIDsByLibrary).mockReturnValue([1, 2]);

      await runBatchUpdateAll(makeDeps(), { groupID: 0 });

      expect(getIndexedItemIDsByLibrary).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        USER_LIBRARY_ID,
      );
    });

    it("reports an unavailable group instead of a settings mismatch", async () => {
      await expect(
        runBatchUpdateAll(makeDeps(), { groupID: 99 }),
      ).resolves.toEqual({ outcome: "unavailable-target" });
      expect(getIndexedItemIDsByLibrary).not.toHaveBeenCalled();
    });

    it("resolves a collection inside the named library only", async () => {
      vi.mocked(getIndexedItemIDsByCollection).mockReturnValue([4, 5]);

      await expect(
        runBatchUpdateAll(makeDeps(), {
          groupID: 7,
          collectionKey: COLLECTION,
        }),
      ).resolves.toEqual({ outcome: "batch-modal" });
      expect(getCollectionIDByKey).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        { libraryID: GROUP_LIBRARY.libraryID, collectionKey: COLLECTION },
      );
      expect(getIndexedItemIDsByCollection).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        { libraryID: GROUP_LIBRARY.libraryID, collectionKey: COLLECTION },
      );
    });

    it("reports an unknown collection key instead of an empty scope", async () => {
      vi.mocked(getCollectionIDByKey).mockReturnValue(undefined);

      await expect(
        runBatchUpdateAll(makeDeps(), {
          groupID: 0,
          collectionKey: COLLECTION,
        }),
      ).resolves.toEqual({ outcome: "collection-not-found" });
      expect(getIndexedItemIDsByCollection).not.toHaveBeenCalled();
    });

    it("reports an empty selection for a collection that holds no items", async () => {
      await expect(
        runBatchUpdateAll(makeDeps(), {
          groupID: 0,
          collectionKey: COLLECTION,
        }),
      ).resolves.toEqual({ outcome: "empty-selection" });
      expect(openedModals).toHaveLength(0);
    });
  });
});
