import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCollectionIDByKey,
  getIndexedItemIDsByCollection,
  getIndexedItemIDsByLibrary,
  getLibraries,
  USER_LIBRARY_ID,
} from "@zotlit/db";
import type { Library } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";

import { defaults } from "@/services/settings/schema";
import type { BatchModalOptions } from "@/views/batch-modal";

import { runBatchUpdateAll } from "./update-batch";
import type { BatchUpdateResult } from "./update-batch";
import type { SingleUpdateDeps } from "./update-single";

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    getLibraries: vi.fn(),
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
    constructor(readonly options: unknown) {}
  }
  return { BatchModal, FlatManifest };
});

const COLLECTION = "ABCD2345";

/** The configured citation library in every fixture: the personal one. */
const PERSONAL_LIBRARY: Library = {
  libraryID: USER_LIBRARY_ID,
  type: "user",
  groupID: null,
  name: null,
};

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
    noteFeature: {} as SingleUpdateDeps["noteFeature"],
    noteIndex: {
      whenIndexed: async () => {},
      getNotesByItemKey: () => [],
    },
  } as unknown as SingleUpdateDeps;
}

beforeEach(() => {
  openedModals.length = 0;
  vi.mocked(getLibraries).mockReset().mockReturnValue([PERSONAL_LIBRARY]);
  vi.mocked(getCollectionIDByKey).mockReset().mockReturnValue(100);
  vi.mocked(getIndexedItemIDsByLibrary).mockReset().mockReturnValue([]);
  vi.mocked(getIndexedItemIDsByCollection).mockReset().mockReturnValue([]);
});

describe("runBatchUpdateAll", () => {
  it("returns db-unavailable when the database is closed", async () => {
    await expect(runBatchUpdateAll(makeDeps("loading"))).resolves.toEqual({
      outcome: "db-unavailable",
    } satisfies BatchUpdateResult);
    expect(getIndexedItemIDsByLibrary).not.toHaveBeenCalled();
  });

  it("stops on a library mismatch before scanning for items", async () => {
    await expect(
      runBatchUpdateAll(makeDeps(), { expectedGroupID: 7 }),
    ).resolves.toEqual({ outcome: "library-mismatch" });
    expect(getIndexedItemIDsByLibrary).not.toHaveBeenCalled();
  });

  it("reports an unknown collection key instead of an empty scope", async () => {
    vi.mocked(getCollectionIDByKey).mockReturnValue(undefined);

    await expect(
      runBatchUpdateAll(makeDeps(), { collectionKey: COLLECTION }),
    ).resolves.toEqual({ outcome: "collection-not-found" });
    expect(getIndexedItemIDsByCollection).not.toHaveBeenCalled();
  });

  it("reports an empty selection for a collection that holds no items", async () => {
    await expect(
      runBatchUpdateAll(makeDeps(), { collectionKey: COLLECTION }),
    ).resolves.toEqual({ outcome: "empty-selection" });
    expect(openedModals).toHaveLength(0);
  });

  it("updates every item the library holds", async () => {
    vi.mocked(getIndexedItemIDsByLibrary).mockReturnValue([1, 2, 3]);

    await expect(runBatchUpdateAll(makeDeps())).resolves.toEqual({
      outcome: "batch-modal",
    });
    expect(getIndexedItemIDsByLibrary).toHaveBeenCalledWith(
      expect.anything(),
      USER_LIBRARY_ID,
    );
    expect(openedModals[0]?.total).toBe(3);
  });

  it("scopes to the named collection within the configured library", async () => {
    vi.mocked(getIndexedItemIDsByCollection).mockReturnValue([4, 5]);

    await expect(
      runBatchUpdateAll(makeDeps(), { collectionKey: COLLECTION }),
    ).resolves.toEqual({ outcome: "batch-modal" });
    expect(getIndexedItemIDsByCollection).toHaveBeenCalledWith(
      expect.anything(),
      { libraryID: USER_LIBRARY_ID, collectionKey: COLLECTION },
    );
    expect(getIndexedItemIDsByLibrary).not.toHaveBeenCalled();
    expect(openedModals[0]?.total).toBe(2);
  });
});
