import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getAnnotationsByKey,
  getAttachmentsByParents,
  getCitekeysByLibrary,
  getCollectionIDByKey,
  getIndexedItemIDsByLibrary,
  getIndexedItemsByID,
  getItemsByID,
  getLibraries,
  getNoteItemIDsByCollection,
  getNoteItemIDsByLibrary,
  getNoteRefsByItemIDs,
  getRelatedKeysByItemID,
  getSchemaVersions,
  getTrashedNoteItemIDs,
  isItemKey,
  resolveItemTags,
} from "@zotlit/db";
import type { IndexedItem } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { attachmentAbsPath } from "@zotlit/db/path";

import {
  ANNOTATIONS,
  ATTACHMENTS,
  BUILD_TIMESTAMP,
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
import { QUIET_FIRST_RUN_PREFS } from "./paired-zotero.ts";
import { PRISTINE_SCHEMA_VERSIONS } from "./pristine.ts";

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
function openClientAt(databasePath: string): NodeDatabaseClient & Disposable {
  const db = createClient(databasePath);
  return Object.assign(db, {
    [Symbol.dispose]: () => {
      db.$client.close();
    },
  });
}

function openClient(): NodeDatabaseClient & Disposable {
  return openClientAt(layout.databasePath);
}

/** Indexed items of one Library, in the reader's own `dateModified desc` order. */
function indexedItems(
  db: NodeDatabaseClient,
  libraryID: number,
): IndexedItem[] {
  return getIndexedItemsByID(db, getIndexedItemIDsByLibrary(db, libraryID));
}

async function digest(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

/** Semantic snapshot a build has to reproduce, apart from its host-native path. */
function readSemantics(fixtureLayout: FixtureLayout): string {
  using sqlite = new DatabaseSync(fixtureLayout.databasePath, {
    readOnly: true,
  });
  const items = sqlite
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
  using db = openClientAt(fixtureLayout.databasePath);
  const attachments = getAttachmentsByParents(db, [20]).map(
    ({ dateAdded, dateModified, ...attachment }) => ({
      ...attachment,
      path: attachment.linkMode === 2 ? "<host-native-path>" : attachment.path,
      dateAdded: dateAdded.epochMilliseconds,
      dateModified: dateModified.epochMilliseconds,
    }),
  );
  const annotations = getAnnotationsByKey(
    db,
    ANNOTATIONS.map(({ key }) => key),
    1,
  ).map(({ dateAdded, dateModified, ...annotation }) => ({
    ...annotation,
    dateAdded: dateAdded.epochMilliseconds,
    dateModified: dateModified.epochMilliseconds,
  }));
  return JSON.stringify({ items, attachments, annotations });
}

async function readAttachmentTree(
  fixtureLayout: FixtureLayout,
): Promise<readonly { key: string; sha256: string | null }[]> {
  using db = openClientAt(fixtureLayout.databasePath);
  return Promise.all(
    getAttachmentsByParents(db, [20])
      .filter(({ linkMode }) => linkMode !== 3)
      .map(async (attachment) => {
        const path = attachmentAbsPath(attachment, {
          dataDir: fixtureLayout.dataDir,
          baseAttachmentPath: null,
        })!;
        const sha256 = await digest(path).catch(() => null);
        return { key: attachment.key, sha256 };
      }),
  );
}

/** Page box from the committed PDF's uncompressed page tree. */
function readPdfPageBox(pdf: Buffer, pageIndex: number): number[] {
  const source = pdf.toString("latin1");
  const objectBody = (id: number): string => {
    const start = source.indexOf(`\n${id} 0 obj\n`);
    const end = source.indexOf("\nendobj", start);
    return source.slice(start, end);
  };
  const pages = objectBody(2);
  const kidsStart = pages.indexOf("[", pages.indexOf("/Kids"));
  const kidsEnd = pages.indexOf("]", kidsStart);
  const pageIDs = pages
    .slice(kidsStart + 1, kidsEnd)
    .split("\n")
    .map((line) => Number.parseInt(line, 10))
    .filter(Number.isFinite);
  const page = objectBody(pageIDs[pageIndex]!);
  const boxStart = page.indexOf("[", page.indexOf("/MediaBox"));
  const boxEnd = page.indexOf("]", boxStart);
  return page
    .slice(boxStart + 1, boxEnd)
    .split(" ")
    .map(Number);
}

describe("the generated Zotero database", () => {
  it("opens through ZotLit's database layer at the Zotero 10 schema versions", () => {
    using db = openClient();

    expect(getSchemaVersions(db)).toEqual({
      ...PRISTINE_SCHEMA_VERSIONS,
      supported: true,
    });
  });

  it("passes the integrity checks a real Zotero runs at startup", () => {
    using sqlite = new DatabaseSync(layout.databasePath, { readOnly: true });

    expect(sqlite.prepare("pragma integrity_check").all()).toEqual([
      { integrity_check: "ok" },
    ]);
    expect(sqlite.prepare("pragma foreign_key_check").all()).toEqual([]);
  });

  it("carries Zotero's own item types and base-field mappings", () => {
    using db = openClient();

    // A bookSection stores its container under `bookTitle`, which only reads
    // back as `publicationTitle` through Zotero's own base-field mapping.
    const bookSection = indexedItems(db, 1).find(
      (item) => item.key === "EEEE5555",
    );

    expect(bookSection).toMatchObject({
      itemType: "bookSection",
      publicationTitle: "Collected Personal Essays",
    });
  });

  it("reads manual and automatic tags through the public tag query", () => {
    using db = openClient();

    expect(
      resolveItemTags(db, 1, new Map()).map(({ tag, type }) => ({
        name: tag.name,
        type,
      })),
    ).toEqual([
      { name: "fixture-core", type: 0 },
      { name: "read-later", type: 1 },
    ]);
  });

  it("reads reciprocal related Items through the public relation query", () => {
    using db = openClient();

    expect(getRelatedKeysByItemID(db, 1)).toEqual(["EEEE5555"]);
    expect(getRelatedKeysByItemID(db, 5)).toEqual(["AAAAAAAA"]);
  });

  it("reads multiple creator roles and a single-field name in Zotero order", () => {
    using db = openClient();

    expect(getItemsByID(db, [1])[0]?.creators).toEqual([
      {
        firstName: "Ada",
        lastName: "Personal",
        creatorType: "author",
        fieldMode: 0,
      },
      {
        firstName: "Erin",
        lastName: "Editor",
        creatorType: "editor",
        fieldMode: 0,
      },
      {
        firstName: null,
        lastName: "ZotLit Research Collective",
        creatorType: "contributor",
        fieldMode: 1,
      },
    ]);
  });

  it("reads a trashed Note through the public trash query", () => {
    using db = openClient();

    expect(getTrashedNoteItemIDs(db, [19])).toEqual(new Set([19]));
    expect(getNoteRefsByItemIDs(db, [19])).toEqual([]);
  });

  it("resolves every file-backed Attachment and preserves one deliberate miss", async () => {
    using db = openClient();
    const attachments = getAttachmentsByParents(db, [20]);

    expect(new Set(attachments.map(({ linkMode }) => linkMode))).toEqual(
      new Set([0, 1, 2, 3]),
    );

    const paths = new Map(
      attachments.map((attachment) => [
        attachment.key,
        attachmentAbsPath(attachment, {
          dataDir: layout.dataDir,
          baseAttachmentPath: null,
        }),
      ]),
    );
    expect(paths.get("LINKURL2")).toBeNull();
    expect(isAbsolute(paths.get("PDFLINKD")!)).toBe(true);
    expect(attachments.find(({ key }) => key === "LINKURL2")?.path).toBe(
      "https://www.storybookscanada.ca/stories/en/0315/",
    );

    const fileStates = await Promise.all(
      [...paths]
        .filter((entry): entry is [string, string] => entry[1] !== null)
        .map(async ([key, path]) => ({
          key,
          exists: await stat(path).then(
            () => true,
            () => false,
          ),
        })),
    );
    expect(fileStates).toEqual([
      { key: "PDFSTR22", exists: true },
      { key: "HTMLSNAP", exists: true },
      { key: "PDFLINKD", exists: true },
      { key: "MISSNG22", exists: false },
    ]);
  });

  it("reads PDF Annotations whose anchors fit the source page", async () => {
    using db = openClient();
    const annotations = getAnnotationsByKey(db, ["HIGHLGHT", "NTMARK22"], 1);

    expect(
      annotations.map(({ key, parentKey, type, pageLabel }) => ({
        key,
        parentKey,
        type,
        pageLabel,
      })),
    ).toEqual([
      { key: "HIGHLGHT", parentKey: "PDFSTR22", type: 1, pageLabel: "2" },
      { key: "NTMARK22", parentKey: "PDFSTR22", type: 2, pageLabel: "2" },
    ]);

    const pdf = getAttachmentsByParents(db, [20]).find(
      ({ key }) => key === "PDFSTR22",
    )!;
    const pdfPath = attachmentAbsPath(pdf, {
      dataDir: layout.dataDir,
      baseAttachmentPath: null,
    })!;
    const pdfBytes = await readFile(pdfPath);
    expect(createHash("sha256").update(pdfBytes).digest("hex")).toBe(
      "c16a4daca0352fad9fec09a59083ed2b2e36cd8e963395a8dd79ebb4432437e5",
    );
    const [minX, minY, maxX, maxY] = readPdfPageBox(pdfBytes, 1);
    expect([minX, minY, maxX, maxY]).toEqual([0, 0, 792, 612]);

    for (const annotation of annotations) {
      const position = annotation.position as {
        pageIndex: number;
        rects: [number, number, number, number][];
      };
      expect(position.pageIndex).toBe(1);
      expect(position.rects.length).toBeGreaterThan(0);
      for (const [left, bottom, right, top] of position.rects) {
        expect(minX! <= left && left < right && right <= maxX!).toBe(true);
        expect(minY! <= bottom && bottom < top && top <= maxY!).toBe(true);
      }
    }
  });

  it("builds an offline HTML snapshot with the licensed story", async () => {
    using db = openClient();
    const snapshot = getAttachmentsByParents(db, [20]).find(
      ({ key }) => key === "HTMLSNAP",
    )!;
    const path = attachmentAbsPath(snapshot, {
      dataDir: layout.dataDir,
      baseAttachmentPath: null,
    })!;
    const html = await readFile(path, "utf-8");

    expect(createHash("sha256").update(html).digest("hex")).toBe(
      "41dd001c025c2e3fce1464583154bf9eec72534242bed778436d34be99705a44",
    );
    expect(html).toContain("Sakima lived with his parents");
    expect(html).toContain("Written by Ursula Nafula");
    expect(html).toContain("Illustrated by Peris Wachuka");
    expect(html).toContain("Creative Commons Attribution 4.0 International");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<audio");
    expect(html).not.toContain('src="http');
    expect(html).not.toContain('href="/');
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
      ...ATTACHMENTS.map((attachment) => attachment.key),
      ...ANNOTATIONS.map((annotation) => annotation.key),
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

  // Zotero's schema defaults several timestamp columns to `CURRENT_TIMESTAMP`.
  // A row that falls back to that default carries the time of the build, so two
  // builds stop matching. Every Fixture timestamp is therefore a fixed Spec
  // value, and this guard covers the columns a later Spec grows into.
  it("stamps every clock-defaulted column from the Spec", () => {
    using sqlite = new DatabaseSync(layout.databasePath, { readOnly: true });
    const query = <T>(sql: string): T[] => sqlite.prepare(sql).all() as T[];

    const stamps = query<{ name: string }>(
      "select name from sqlite_master where type = 'table'",
    ).flatMap(({ name: table }) =>
      query<{ name: string; dflt_value: string | null }>(
        `pragma table_info("${table}")`,
      )
        .filter((column) => column.dflt_value === "CURRENT_TIMESTAMP")
        .flatMap((column) =>
          query<{ stamp: string }>(
            `select distinct "${column.name}" as stamp from "${table}"`,
          ).map(({ stamp }) => ({ column: `${table}.${column.name}`, stamp })),
        ),
    );
    const spec = new Set([
      BUILD_TIMESTAMP,
      ...ITEMS.map((item) => item.dateModified),
      ...NOTES.map((note) => note.dateModified),
      ...ATTACHMENTS.map((attachment) => attachment.dateModified),
      ...ANNOTATIONS.map((annotation) => annotation.dateModified),
    ]);
    const offenders = stamps
      .filter(({ stamp }) => !spec.has(stamp))
      .map(({ column, stamp }) => `${column} = ${stamp}`);

    expect(offenders).toEqual([]);
    // A build that stamped nothing would pass the check above vacuously.
    expect(stamps).not.toEqual([]);
  });

  it("rebuilds the same semantics and files at another host-native path", async () => {
    const before = readSemantics(layout);
    const filesBefore = await readAttachmentTree(layout);
    const comparisonLayout = getFixtureLayout(
      await mkdtemp(join(dirname(layout.root), "fixture-rebuild-")),
    );
    fixture.defer(() =>
      rm(comparisonLayout.root, { recursive: true, force: true }),
    );
    await buildFixture(comparisonLayout);

    expect(readSemantics(comparisonLayout)).toBe(before);
    expect(await readAttachmentTree(comparisonLayout)).toEqual(filesBefore);

    using firstDb = openClientAt(layout.databasePath);
    using secondDb = openClientAt(comparisonLayout.databasePath);
    const linkedPath = (db: NodeDatabaseClient): string | null =>
      getAttachmentsByParents(db, [20]).find(({ linkMode }) => linkMode === 2)!
        .path;
    expect(linkedPath(firstDb)).not.toBe(linkedPath(secondDb));
  });

  it("rebuilds one layout byte for byte", async () => {
    const before = readSemantics(layout);
    const bytes = await digest(layout.databasePath);
    await buildFixture(layout);

    expect(readSemantics(layout)).toBe(before);
    expect(await digest(layout.databasePath)).toBe(bytes);
  });
});

describe("the generated Obsidian vault", () => {
  it("points at the fixture data directory through the fixture profile", async () => {
    const prefs = await readFile(join(layout.profileDir, "prefs.js"), "utf-8");

    expect(prefs).toContain(JSON.stringify(layout.dataDir));
    expect(prefs).toContain("extensions.zotero.useDataDir");
  });

  it("quiets the first run, so a Paired Zotero opens no start page", async () => {
    const prefs = await readFile(join(layout.profileDir, "prefs.js"), "utf-8");

    // `firstRun2` is the one that opens the start page; the rest keep the
    // profile quiet in other ways.
    for (const line of QUIET_FIRST_RUN_PREFS) expect(prefs).toContain(line);
  });

  it("starts the companion without a sideload confirmation", async () => {
    const prefs = await readFile(join(layout.profileDir, "prefs.js"), "utf-8");

    expect(prefs).toContain('user_pref("extensions.autoDisableScopes", 0);');
  });

  it("saves a Library Scope the plugin can load", async () => {
    const data = JSON.parse(
      await readFile(layout.pluginDataPath, "utf-8"),
    ) as Record<string, unknown>;

    expect(data.__VERSION__).toBe(9);
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
