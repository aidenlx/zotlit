import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getCitekeysByLibrary,
  getCollectionIDByKey,
  getIndexedItemIDsByLibrary,
  getIndexedItemsByID,
  getLibraries,
  getNoteItemIDsByCollection,
  getNoteItemIDsByLibrary,
  getNoteRefsByItemIDs,
  getSchemaVersions,
  isItemKey,
} from "@zotlit/db";
import type { IndexedItem } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import {
  buildFixture,
  COLLECTIONS,
  getFixtureLayout,
  ITEMS,
  LIBRARY_SCOPE_SETTING_KEY,
  NOTES,
  SCOPE_CASES,
  selectScopeCase,
} from "./build.ts";
import type { FixtureLayout } from "./build.ts";

import { getWorkspaceRoot } from "#package-roots";

let layout: FixtureLayout;
const fixture = new AsyncDisposableStack();

beforeAll(async () => {
  // Workspace scratch, not the system temp dir — see policies/scratch-artifacts.md.
  const scratch = join(await getWorkspaceRoot(import.meta.dirname), "tmp");
  await mkdir(scratch, { recursive: true });
  layout = getFixtureLayout(await mkdtemp(join(scratch, "fixture-test-")));
  fixture.defer(() => rm(layout.root, { recursive: true, force: true }));
  await buildFixture(layout);
});

afterAll(() => fixture.disposeAsync());

/** A fixture client whose SQLite handle closes with the enclosing scope. */
function openClient(): NodeDatabaseClient & Disposable {
  const db = createClient(layout.databasePath);
  return Object.assign(db, {
    [Symbol.dispose]: () => {
      db.$client.close();
    },
  });
}

/** Indexed items of one Library, in the reader's own `dateModified desc` order. */
function indexedItems(
  db: NodeDatabaseClient,
  libraryID: number,
): IndexedItem[] {
  return getIndexedItemsByID(db, getIndexedItemIDsByLibrary(db, libraryID));
}

/** Semantic snapshot a rebuild has to reproduce exactly. */
function readSemantics(databasePath: string): string {
  using sqlite = new DatabaseSync(databasePath, { readOnly: true });
  const rows = sqlite
    .prepare(
      `select i.itemID, i.libraryID, i.key, i.dateModified, v.value as citationKey
         from items i
         left join itemData d
           on d.itemID = i.itemID
          and d.fieldID = (select fieldID from fieldsCombined where fieldName = 'citationKey')
         left join itemDataValues v on v.valueID = d.valueID
        order by i.itemID`,
    )
    .all();
  return JSON.stringify(rows);
}

describe("the generated Zotero database", () => {
  it("opens through ZotLit's database layer at a supported schema version", () => {
    using db = openClient();

    expect(getSchemaVersions(db)).toMatchObject({ supported: true });
  });

  it("exposes My Library plus group Libraries, one of them read-only", () => {
    using db = openClient();

    expect(getLibraries(db)).toEqual([
      { libraryID: 1, type: "user", groupID: null, name: null },
      { libraryID: 2, type: "group", groupID: 4200309, name: "Shared Reading" },
      { libraryID: 3, type: "group", groupID: 118, name: "Lab Archive" },
      {
        libraryID: 4,
        type: "group",
        groupID: 990117,
        name: "Consortium Reading Room",
      },
    ]);

    using sqlite = new DatabaseSync(layout.databasePath, { readOnly: true });
    expect(
      sqlite
        .prepare("select editable from libraries where libraryID = 4")
        .get(),
    ).toEqual({ editable: 0 });
  });

  it("repeats a Citation Key inside one Library and across Libraries", () => {
    using db = openClient();

    const personal = getCitekeysByLibrary(db, 1);
    expect(
      personal.filter((row) => row.citekey === "duplicateWithin2020"),
    ).toHaveLength(2);

    const lab = getCitekeysByLibrary(db, 3);
    expect(personal.some((row) => row.citekey === "duplicateAcross2019")).toBe(
      true,
    );
    expect(lab.some((row) => row.citekey === "duplicateAcross2019")).toBe(true);
  });

  it("carries item, note, and collection keys Zotero itself could have generated", () => {
    const keys = [
      ...ITEMS.map((item) => item.key),
      ...NOTES.map((note) => note.key),
      ...COLLECTIONS.map((collection) => collection.key),
    ];

    expect(keys.filter((key) => !isItemKey(key))).toEqual([]);
  });

  it("gives a note import work in every Library", () => {
    using db = openClient();

    expect(getNoteItemIDsByLibrary(db, 1)).toEqual([13, 14, 15]);
    expect(getNoteItemIDsByLibrary(db, 2)).toEqual([16]);
    expect(getNoteItemIDsByLibrary(db, 3)).toEqual([17]);
    expect(getNoteItemIDsByLibrary(db, 4)).toEqual([18]);
  });

  it("gives a collection-scoped note import both child and standalone notes", () => {
    using db = openClient();

    expect(
      getNoteItemIDsByCollection(db, {
        libraryID: 1,
        collectionKey: "SHAREDCL",
      }),
    ).toEqual([13]);
    expect(
      getNoteItemIDsByCollection(db, {
        libraryID: 1,
        collectionKey: "PERSNAL2",
      }),
    ).toEqual([13, 15]);
  });

  it("repeats one bare note key in two Libraries under distinct Indexed Keys", () => {
    using db = openClient();

    expect(
      getNoteRefsByItemIDs(db, [13, 16]).map((note) => note.indexedKey),
    ).toEqual(["NNNNAAAA", "NNNNAAAAg4200309"]);
  });

  it("repeats one bare Zotero key in two Libraries under distinct Indexed Keys", () => {
    using db = openClient();

    const personal = indexedItems(db, 1).find(
      (item) => item.key === "AAAAAAAA",
    );
    const shared = indexedItems(db, 2).find((item) => item.key === "AAAAAAAA");

    expect(personal?.indexedKey).toBe("AAAAAAAA");
    expect(shared?.indexedKey).toBe("AAAAAAAAg4200309");
  });

  it("repeats one collection key in three Libraries", () => {
    using db = openClient();

    expect(
      getCollectionIDByKey(db, { libraryID: 1, collectionKey: "SHAREDCL" }),
    ).toBe(1);
    expect(
      getCollectionIDByKey(db, { libraryID: 2, collectionKey: "SHAREDCL" }),
    ).toBe(2);
    expect(
      getCollectionIDByKey(db, { libraryID: 3, collectionKey: "SHAREDCL" }),
    ).toBe(3);
  });

  it("carries controlled modification times, including cross- and same-Library ties", () => {
    using db = openClient();

    const stamps = indexedItems(db, 1).map(
      (item) => item.dateModified.epochMilliseconds,
    );
    expect(stamps).toEqual([...stamps].sort((a, b) => b - a));

    const at = (libraryID: number, key: string): number => {
      const item = indexedItems(db, libraryID).find(
        (candidate) => candidate.key === key,
      );
      if (!item) throw new Error(`missing ${key} in library ${libraryID}`);
      return item.dateModified.epochMilliseconds;
    };
    // Same-Library tie, and a cross-Library tie between groups 118 and 4200309.
    expect(at(1, "JJJJJJJJ")).toBe(at(1, "KKKKKKKK"));
    expect(at(3, "HHHH8888")).toBe(at(2, "FFFF6666"));
    // Most recent overall sits in My Library, above every group Library.
    expect(at(1, "AAAAAAAA")).toBeGreaterThan(at(2, "AAAAAAAA"));
  });

  it("rebuilds to the same semantic data", async () => {
    const before = readSemantics(layout.databasePath);
    await buildFixture(layout);

    expect(readSemantics(layout.databasePath)).toBe(before);
  });
});

describe("the generated Obsidian vault", () => {
  it("points at the fixture data directory through the fixture profile", async () => {
    const prefs = await readFile(join(layout.profileDir, "prefs.js"), "utf-8");

    expect(prefs).toContain(JSON.stringify(layout.dataDir));
    expect(prefs).toContain("extensions.zotero.useDataDir");
  });

  it("saves a Library Scope the plugin can load", async () => {
    const data = JSON.parse(
      await readFile(layout.pluginDataPath, "utf-8"),
    ) as Record<string, unknown>;

    expect(data.__VERSION__).toBe(8);
    expect(data[LIBRARY_SCOPE_SETTING_KEY]).toEqual({ mode: "all" });
  });

  it("selects the available, partial, and fully unavailable scope cases", async () => {
    for (const scopeCase of SCOPE_CASES) {
      await selectScopeCase(layout, scopeCase.id);
      const data = JSON.parse(
        await readFile(layout.pluginDataPath, "utf-8"),
      ) as Record<string, unknown>;

      expect(data[LIBRARY_SCOPE_SETTING_KEY]).toEqual(scopeCase.scope);
    }

    expect(SCOPE_CASES.map((scopeCase) => scopeCase.id)).toEqual([
      "all",
      "available",
      "partial",
      "unavailable",
    ]);
  });
});
