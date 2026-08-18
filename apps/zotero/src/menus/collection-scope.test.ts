import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { contextScope } from "./collection-scope.js";

type LibraryMenuContext = _ZoteroTypes.MenuManager.LibraryMenuContext;

const USER_LIBRARY_ID = 1;
const GROUP_LIBRARY_ID = 7;

/** Group ids are derived from library ids by an offset in the stub. */
const groupIDOf = (libraryID: number): number => libraryID + 100;

interface RowShape {
  kind: "collection" | "group" | "library" | "search";
  libraryID?: number;
  key?: string;
}

function row({
  kind,
  libraryID = USER_LIBRARY_ID,
  key = "COLLKEY1",
}: RowShape): Zotero.CollectionTreeRow {
  return {
    isCollection: () => kind === "collection",
    isGroup: () => kind === "group",
    isLibrary: () => kind === "library" || kind === "group",
    ref: { libraryID, key },
  } as unknown as Zotero.CollectionTreeRow;
}

/** Zotero 9 supplies the singular value and no plural. */
function zotero9Context(
  collectionTreeRow: Zotero.CollectionTreeRow | undefined,
): LibraryMenuContext {
  return { collectionTreeRow } as unknown as LibraryMenuContext;
}

/**
 * Zotero 10 supplies the plural beside a singular getter that throws, so any
 * read of the singular fails the test rather than the user's menu.
 */
function zotero10Context(
  collectionTreeRows: Zotero.CollectionTreeRow[],
): LibraryMenuContext {
  return {
    get collectionTreeRow(): never {
      throw new Error(
        "collectionTreeRow was removed -- use collectionTreeRows",
      );
    },
    collectionTreeRows,
  } as unknown as LibraryMenuContext;
}

beforeEach(() => {
  (globalThis as { Zotero?: unknown }).Zotero = {
    Libraries: { userLibraryID: USER_LIBRARY_ID },
    Groups: { getGroupIDFromLibraryID: groupIDOf },
  };
});

afterEach(() => {
  delete (globalThis as { Zotero?: unknown }).Zotero;
});

describe("contextScope", () => {
  describe("Zotero 9 context shape", () => {
    it("scopes a collection row to its key in the personal library", () => {
      expect(contextScope(zotero9Context(row({ kind: "collection" })))).toEqual(
        { groupID: 0, collectionKey: "COLLKEY1" },
      );
    });

    it("scopes a library row to the personal library", () => {
      expect(contextScope(zotero9Context(row({ kind: "library" })))).toEqual({
        groupID: 0,
      });
    });

    it("declines a row-less context", () => {
      expect(contextScope(zotero9Context(undefined))).toBeNull();
    });
  });

  describe("Zotero 10 context shape", () => {
    it("scopes the sole selected collection row without reading the singular", () => {
      expect(
        contextScope(zotero10Context([row({ kind: "collection" })])),
      ).toEqual({ groupID: 0, collectionKey: "COLLKEY1" });
    });

    it("declines a multi-row selection", () => {
      expect(
        contextScope(
          zotero10Context([
            row({ kind: "collection", key: "COLLKEY1" }),
            row({ kind: "collection", key: "COLLKEY2" }),
          ]),
        ),
      ).toBeNull();
    });

    it("declines an empty selection", () => {
      expect(contextScope(zotero10Context([]))).toBeNull();
    });
  });

  describe("row kinds", () => {
    it("scopes a group row to its group id and no collection", () => {
      expect(
        contextScope(
          zotero10Context([
            row({ kind: "group", libraryID: GROUP_LIBRARY_ID }),
          ]),
        ),
      ).toEqual({ groupID: groupIDOf(GROUP_LIBRARY_ID) });
    });

    it("scopes a collection inside a group to that group", () => {
      expect(
        contextScope(
          zotero10Context([
            row({ kind: "collection", libraryID: GROUP_LIBRARY_ID }),
          ]),
        ),
      ).toEqual({
        groupID: groupIDOf(GROUP_LIBRARY_ID),
        collectionKey: "COLLKEY1",
      });
    });

    it("declines a saved-search row", () => {
      expect(
        contextScope(zotero10Context([row({ kind: "search" })])),
      ).toBeNull();
    });
  });
});
