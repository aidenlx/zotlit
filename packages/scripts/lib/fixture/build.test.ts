import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getAnnotationsByKey,
  getAttachmentsByParents,
  getCitekeysByLibrary,
  getCollectionIDByKey,
  getIndexedItemIDsByLibrary,
  getIndexedItemIDsByCollection,
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
import { attachmentAbsPath, resolveAnnotCachePath } from "@zotlit/db/path";

import {
  ANNOTATIONS,
  ATTACHMENTS,
  BUILD_TIMESTAMP,
  buildFixture,
  COLLECTIONS,
  getFixtureLayout,
  INSTALLED_STYLES,
  ITEMS,
  legacyTemplateFilename,
  legacyTemplateSource,
  LIBRARY_SCOPE_SETTING_KEY,
  NOTES,
  SCOPE_CASES,
  selectScopeCase,
  UPGRADER_FRONTMATTER_FIELDS,
  UPGRADER_LEGACY_TEMPLATES,
  VAULT_CASES,
} from "./build.ts";
import type { FixtureLayout } from "./build.ts";
import { BETTER_BIBTEX_PREFS, QUIET_FIRST_RUN_PREFS } from "./paired-zotero.ts";
import { PRISTINE_SCHEMA_VERSIONS } from "./pristine.ts";

import { getWorkspaceRoot } from "#package-roots";

let layout: FixtureLayout;
const fixture = new AsyncDisposableStack();
const ATTACHMENT_PARENT_IDS = [
  ...new Set(ATTACHMENTS.map(({ parentItemID }) => parentItemID)),
];
const ROUGIER_ANNOTATION_KEYS = [
  "TYY6Z6ZF",
  "4PE492KU",
  "HRK7BG32",
  "K3JRFLFQ",
  "PUPR5FG5",
  "C94NJNYG",
  "FDRFQ7C2",
] as const;

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

function indexedItemCount(db: NodeDatabaseClient): number {
  return getLibraries(db).reduce(
    (count, library) =>
      count + getIndexedItemIDsByLibrary(db, library.libraryID).length,
    0,
  );
}

async function buildTemporaryStressFixture(
  prefix: string,
  stressItemCount: number,
): Promise<FixtureLayout> {
  const generatedLayout = getFixtureLayout(
    await mkdtemp(join(dirname(layout.root), prefix)),
  );
  fixture.defer(() =>
    rm(generatedLayout.root, { recursive: true, force: true }),
  );
  await buildFixture(generatedLayout, { stressItemCount });
  return generatedLayout;
}

/** Public-query snapshot of every discoverable Item's generated semantics. */
function readIndexedItemSemantics(fixtureLayout: FixtureLayout): string {
  using db = openClientAt(fixtureLayout.databasePath);
  const itemIDs = getLibraries(db).flatMap(({ libraryID }) =>
    getIndexedItemIDsByLibrary(db, libraryID),
  );
  const collectionItems = new Map(
    COLLECTIONS.map((collection) => [
      collection.collectionID,
      new Set(
        getIndexedItemIDsByCollection(db, {
          libraryID: collection.libraryID,
          collectionKey: collection.key,
        }),
      ),
    ]),
  );
  const tagMemo = new Map();
  const items = getIndexedItemsByID(db, itemIDs).map(
    ({ dateModified, ...item }) => ({
      ...item,
      dateModified: dateModified.epochMilliseconds,
      tags: resolveItemTags(db, item.itemID, tagMemo).map(({ tag, type }) => ({
        name: tag.name,
        type,
      })),
      collectionIDs: [...collectionItems]
        .filter(([, members]) => members.has(item.itemID))
        .map(([collectionID]) => collectionID),
    }),
  );
  return JSON.stringify(items);
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
  const attachments = getAttachmentsByParents(db, ATTACHMENT_PARENT_IDS).map(
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
    getAttachmentsByParents(db, ATTACHMENT_PARENT_IDS)
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

  it("stores Notes in the HTML envelope written by Zotero 10", () => {
    using sqlite = new DatabaseSync(layout.databasePath, { readOnly: true });
    const notes = sqlite
      .prepare("select note from itemNotes order by itemID")
      .all() as { note: string }[];

    expect(notes).toHaveLength(NOTES.length);
    for (const { note } of notes) {
      expect(
        note.startsWith(
          '<div class="zotero-note znv1"><div data-schema-version="9">',
        ),
      ).toBe(true);
      expect(note.endsWith("\n</div></div>")).toBe(true);
    }
  });

  it("stores Attachment fields where Zotero reads them", () => {
    using sqlite = new DatabaseSync(layout.databasePath, { readOnly: true });
    const attachments = sqlite
      .prepare(
        `select i.key,
                a.path,
                a.charsetID,
                (select v.value
                   from itemData d
                   join itemDataValues v using (valueID)
                  where d.itemID = i.itemID
                    and d.fieldID = (select fieldID from fieldsCombined where fieldName = 'title')) as title,
                (select v.value
                   from itemData d
                   join itemDataValues v using (valueID)
                  where d.itemID = i.itemID
                    and d.fieldID = (select fieldID from fieldsCombined where fieldName = 'url')) as url
           from itemAttachments a
           join items i using (itemID)
          order by i.itemID`,
      )
      .all();

    expect(attachments).toEqual([
      {
        key: "PDFSTR22",
        path: "storage:sakimas-song.pdf",
        charsetID: null,
        title: "Sakima's Song PDF",
        url: null,
      },
      {
        key: "HTMLSNAP",
        path: "storage:sakimas-song.html",
        charsetID: 1,
        title: "Sakima's Song Snapshot",
        url: "https://www.storybookscanada.ca/stories/en/0315/",
      },
      {
        key: "PDFLINKD",
        path: join(layout.linkedFilesDir, "sakimas-song.pdf"),
        charsetID: null,
        title: "Sakima's Song Linked PDF",
        url: null,
      },
      {
        key: "LINKURL2",
        path: null,
        charsetID: null,
        title: "Sakima's Song Web Page",
        url: "https://www.storybookscanada.ca/stories/en/0315/",
      },
      {
        key: "MISSNG22",
        path: "storage:deliberately-missing.pdf",
        charsetID: null,
        title: "Deliberately Missing PDF",
        url: null,
      },
      {
        key: "IANPDF25",
        path: "storage:ioannidis-2005.pdf",
        charsetID: null,
        title: "Ioannidis 2005 PDF",
        url: null,
      },
      {
        key: "RGRPDF24",
        path: join(layout.vaultDir, "attachments", "rougier-2014.pdf"),
        charsetID: null,
        title: "Rougier et al. 2014 PDF",
        url: null,
      },
      {
        key: "CNPDF26A",
        path: "storage:research-interfaces.pdf",
        charsetID: null,
        title: "Research interfaces conference paper",
        url: null,
      },
    ]);
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

  it("resolves a Venue for every shape of the chain", () => {
    using db = openClient();

    expect(
      getItemsByID(db, [1, 5, 57, 58, 59]).map(({ key, venue }) => [
        key,
        venue,
      ]),
    ).toEqual([
      // A native container field, then an aliased one.
      ["AAAAAAAA", "Journal of Personal Records"],
      ["EEEE5555", "Collected Personal Essays"],
      // An aliased publisher-role field, then a native one.
      ["PREPRNT2", "arXiv"],
      ["BKPUBLR4", "Fixture University Press"],
      // An item type that records neither role.
      ["LETTERS5", null],
    ]);
  });

  it("gives the container role precedence over the publisher role", () => {
    using db = openClient();
    const bookSection = getItemsByID(db, [5])[0]!;

    expect(bookSection.baseFields).toMatchObject({
      publicationTitle: "Collected Personal Essays",
      publisher: "Essay House",
    });
    expect(bookSection.venue).toBe("Collected Personal Essays");
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
    expect(attachments.find(({ key }) => key === "PDFLINKD")?.path).toBe(
      join(layout.linkedFilesDir, "sakimas-song.pdf"),
    );
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

  it("reads a real academic article with its imported PDF", async () => {
    using db = openClient();
    const article = indexedItems(db, 1).find(({ key }) => key === "IANNP5A2");

    expect(article).toMatchObject({
      itemType: "journalArticle",
      title: "Why Most Published Research Findings Are False",
      publicationTitle: "PLoS Medicine",
      date: "2005",
      creators: [
        {
          firstName: "John P. A.",
          lastName: "Ioannidis",
          fieldMode: 0,
        },
      ],
    });

    const attachment = getAttachmentsByParents(db, [28]).find(
      ({ key }) => key === "IANPDF25",
    )!;
    const path = attachmentAbsPath(attachment, {
      dataDir: layout.dataDir,
      baseAttachmentPath: null,
    })!;
    const pdf = await readFile(path);

    expect(attachment).toMatchObject({
      linkMode: 0,
      contentType: "application/pdf",
      path: "storage:ioannidis-2005.pdf",
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(createHash("sha256").update(pdf).digest("hex")).toBe(
      "ffc1005680cb620eec4c913437dfabbf311b535cfe16cbaeb2faec1f92afc362",
    );
  });

  it("places a linked literature PDF inside the Fixture Vault", async () => {
    using db = openClient();
    const article = indexedItems(db, 1).find(({ key }) => key === "RUGIER24");

    expect(article).toMatchObject({
      itemType: "journalArticle",
      title: "Ten Simple Rules for Better Figures",
      publicationTitle: "PLOS Computational Biology",
      date: "2014",
      creators: [
        { firstName: "Nicolas P.", lastName: "Rougier", fieldMode: 0 },
        { firstName: "Michael", lastName: "Droettboom", fieldMode: 0 },
        { firstName: "Philip E.", lastName: "Bourne", fieldMode: 0 },
      ],
    });

    const attachment = getAttachmentsByParents(db, [46]).find(
      ({ key }) => key === "RGRPDF24",
    )!;
    const path = attachmentAbsPath(attachment, {
      dataDir: layout.dataDir,
      baseAttachmentPath: null,
    })!;
    const pdf = await readFile(path);

    expect(attachment).toMatchObject({
      linkMode: 2,
      contentType: "application/pdf",
      path: join(layout.vaultDir, "attachments", "rougier-2014.pdf"),
    });
    expect(createHash("sha256").update(pdf).digest("hex")).toBe(
      "95b6714aa1ce1e058475c9a807fa85e058bdaa5c3261e792dc5e8dfd9ae83ad6",
    );
  });

  it("targets the Development Vault during Paired Run preparation", async () => {
    const pairedLayout = getFixtureLayout(
      await mkdtemp(join(dirname(layout.root), "paired-vault-test-")),
    );
    fixture.defer(() =>
      rm(pairedLayout.root, { recursive: true, force: true }),
    );
    const developmentVault = join(
      dirname(pairedLayout.root),
      "development-vault",
    );

    await buildFixture(pairedLayout, {
      linkedAttachmentVaultDir: developmentVault,
    });

    using db = openClientAt(pairedLayout.databasePath);
    const attachment = getAttachmentsByParents(db, [46]).find(
      ({ key }) => key === "RGRPDF24",
    )!;
    const expectedPath = join(
      developmentVault,
      "attachments",
      "rougier-2014.pdf",
    );
    const note = await readFile(
      join(
        pairedLayout.vaultDir,
        "literatures",
        "rougierTenSimpleRules2014.md",
      ),
      "utf-8",
    );

    expect(attachment.path).toBe(expectedPath);
    expect(note).toContain(pathToFileURL(expectedPath).href);
    await expect(
      stat(join(pairedLayout.vaultDir, "attachments", "rougier-2014.pdf")),
    ).resolves.toBeDefined();
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

  it("reproduces every Zotero PDF annotation type from one real session", async () => {
    using db = openClient();
    const annotations = getAnnotationsByKey(db, ROUGIER_ANNOTATION_KEYS, 1);

    expect(
      annotations.map(({ key, type, text, comment, pageLabel }) => ({
        key,
        type,
        text,
        comment,
        pageLabel,
      })),
    ).toEqual([
      {
        key: "TYY6Z6ZF",
        type: 4,
        text: null,
        comment: null,
        pageLabel: "1",
      },
      {
        key: "4PE492KU",
        type: 4,
        text: null,
        comment: null,
        pageLabel: "1",
      },
      {
        key: "HRK7BG32",
        type: 6,
        text: null,
        comment: "Making figures is hard :(",
        pageLabel: "1",
      },
      {
        key: "K3JRFLFQ",
        type: 5,
        text: "Scientific visualization is classically defined as the process of graphically displaying scientific data.",
        comment: null,
        pageLabel: "1",
      },
      {
        key: "PUPR5FG5",
        type: 1,
        text: "Identify Your Message",
        comment: null,
        pageLabel: "1",
      },
      {
        key: "C94NJNYG",
        type: 2,
        text: null,
        comment: "some text comment",
        pageLabel: "1",
      },
      {
        key: "FDRFQ7C2",
        type: 3,
        text: null,
        comment: null,
        pageLabel: "2",
      },
    ]);

    expect(
      Object.fromEntries(
        annotations.map(({ key, position }) => [
          key,
          "paths" in position
            ? "ink"
            : "fontSize" in position
              ? "text"
              : "rects",
        ]),
      ),
    ).toEqual({
      TYY6Z6ZF: "ink",
      "4PE492KU": "ink",
      HRK7BG32: "text",
      K3JRFLFQ: "rects",
      PUPR5FG5: "rects",
      C94NJNYG: "rects",
      FDRFQ7C2: "rects",
    });
    expect(
      annotations.find(({ key }) => key === "HRK7BG32")?.dateAdded.toString(),
    ).toBe("2026-08-23T16:18:18Z");
    expect(
      annotations
        .find(({ key }) => key === "HRK7BG32")
        ?.dateModified.toString(),
    ).toBe("2026-08-23T16:19:07Z");
  });

  it("materializes Zotero's image and ink annotation cache", async () => {
    using db = openClient();
    const expectedHashes = new Map([
      [
        "FDRFQ7C2",
        "4e11544da1bbcea78a5e7fb52e64ef8cc9bf8b02bc8894f6e2d20caa6fb543d0",
      ],
      [
        "TYY6Z6ZF",
        "cec43cbc703d3e5f92ee58e44ea9b4f67fc0019cf16cd5ae1566ea70b14a6143",
      ],
      [
        "4PE492KU",
        "a49d8077da0ad4081d0a830d2bc334a7d33acb6f8d2cc7d05d03b4d11ea36a5f",
      ],
    ]);
    const annotations = getAnnotationsByKey(
      db,
      ROUGIER_ANNOTATION_KEYS,
      1,
    ).filter(({ key }) => expectedHashes.has(key));

    expect(annotations).toHaveLength(3);
    for (const annotation of annotations) {
      const path = resolveAnnotCachePath(annotation, {
        dataDir: layout.dataDir,
        groupID: annotation.groupID,
      })!;
      const png = await readFile(path);

      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect(createHash("sha256").update(png).digest("hex")).toBe(
        expectedHashes.get(annotation.key),
      );
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
      ...ANNOTATIONS.map((annotation) => annotation.dateAdded),
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

describe("a Stress Build", () => {
  it("leaves the default build at the Fixture Spec size", () => {
    using db = openClient();
    expect(indexedItemCount(db)).toBe(ITEMS.length);
  });

  it("adds the requested number of discoverable Items", async () => {
    const stressLayout = await buildTemporaryStressFixture(
      "fixture-stress-",
      32,
    );

    using db = openClientAt(stressLayout.databasePath);
    expect(indexedItemCount(db)).toBe(ITEMS.length + 32);
  });

  it("preserves Fixture invariants and generates deterministic rich content", async () => {
    const stressLayout = await buildTemporaryStressFixture(
      "fixture-stress-content-",
      64,
    );
    const comparisonLayout = await buildTemporaryStressFixture(
      "fixture-stress-comparison-",
      64,
    );

    expect(readIndexedItemSemantics(comparisonLayout)).toBe(
      readIndexedItemSemantics(stressLayout),
    );

    using db = openClientAt(stressLayout.databasePath);
    const synthetic = indexedItems(db, 1).find(
      ({ key }) => key === "S39PX7R9",
    )!;
    expect(synthetic).toMatchObject({
      citationKey: "stress0000001",
      title: "Synthetic stress item 1",
      creators: [
        {
          firstName: "Stress",
          lastName: "Author 1",
          fieldMode: 0,
        },
      ],
    });
    expect(
      resolveItemTags(db, synthetic.itemID, new Map()).map(({ tag, type }) => ({
        name: tag.name,
        type,
      })),
    ).toEqual([
      { name: "stress-bucket-0", type: 1 },
      { name: "stress-build", type: 0 },
    ]);

    const citekeyCount = getLibraries(db).reduce(
      (count, library) =>
        count + getCitekeysByLibrary(db, library.libraryID).length,
      0,
    );
    expect(citekeyCount).toBe(
      ITEMS.filter(({ citationKey }) => citationKey !== null).length + 64,
    );
    expect(
      getCitekeysByLibrary(db, 1).filter(
        ({ citekey }) => citekey === "duplicateWithin2020",
      ),
    ).toHaveLength(2);
    expect(
      getCitekeysByLibrary(db, 3).filter(
        ({ citekey }) => citekey === "duplicateAcross2019",
      ),
    ).toHaveLength(1);
    expect(getLibraries(db).map(({ libraryID }) => libraryID)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(
      [1, 2, 3, 4].map(
        (libraryID) => getNoteItemIDsByLibrary(db, libraryID).length,
      ),
    ).toEqual([3, 1, 1, 1]);
    expect(
      [1, 2, 3].map((libraryID) =>
        getCollectionIDByKey(db, {
          libraryID,
          collectionKey: "SHAREDCL",
        }),
      ),
    ).toEqual([1, 2, 3]);
    expect(
      [1, 2].map(
        (libraryID) =>
          indexedItems(db, libraryID).find(({ key }) => key === "AAAAAAAA")!
            .key,
      ),
    ).toEqual(["AAAAAAAA", "AAAAAAAA"]);

    for (const scopeCase of SCOPE_CASES) {
      await selectScopeCase(stressLayout, scopeCase.id);
      const data = JSON.parse(
        await readFile(stressLayout.pluginDataPath, "utf-8"),
      ) as Record<string, unknown>;
      expect(data[LIBRARY_SCOPE_SETTING_KEY]).toEqual(scopeCase.scope);
    }
  });

  it(
    "builds and opens a 25,000-Item synthetic corpus",
    { timeout: 120_000 },
    async () => {
      const stressLayout = await buildTemporaryStressFixture(
        "fixture-stress-large-",
        25_000,
      );

      using db = openClientAt(stressLayout.databasePath);
      expect(indexedItemCount(db)).toBe(ITEMS.length + 25_000);
    },
  );
});

describe("the generated Obsidian vault", () => {
  it("carries the prose test pages verbatim from committed assets", async () => {
    for (const name of [
      "citekey-smoke-test.md",
      "literature-note-citation-test.md",
      "pandoc-export-error-intent.md",
      "pandoc-export-missing-bibliography.md",
      "pandoc-export-success.md",
      "profile-examples/profile-import-replacement-v1.md",
      "profile-examples/profile-import-replacement-v2.md",
      "profile-examples/profile-import-unavailable-style.md",
      "wikilink-display-test.md",
      "wikilink-parity-test.md",
    ]) {
      const asset = await readFile(
        join(import.meta.dirname, "vault-pages", name),
        "utf-8",
      );

      expect(await readFile(join(layout.vaultDir, name), "utf-8")).toBe(asset);
    }
  });

  it("carries descriptive Profile import examples outside the template folder", async () => {
    const examples = await Promise.all(
      [
        "profile-import-replacement-v1.md",
        "profile-import-replacement-v2.md",
        "profile-import-unavailable-style.md",
      ].map((name) =>
        readFile(join(layout.vaultDir, "profile-examples", name), "utf-8"),
      ),
    );

    expect(examples).toEqual(
      expect.arrayContaining([
        expect.stringContaining("id: ImportV1Abc1"),
        expect.stringContaining(
          "Fixture sample for testing Profile import and replacement.",
        ),
        expect.stringContaining("id: AbsentStyle1"),
        expect.stringContaining(
          "Fixture sample for testing Profile import with an unavailable citation style.",
        ),
      ]),
    );
    expect(examples.join("\n")).not.toMatch(/smoke/i);
  });

  it("carries every tutorial citation form in the Pandoc success case", async () => {
    const note = await readFile(
      join(layout.vaultDir, "pandoc-export-success.md"),
      "utf-8",
    );

    expect(note).toContain("[[literatures/wittNebulinRegulatesThin2006]]");
    expect(note).toContain("#cite:label=chapter&locator=2");
    expect(note).toContain("#cite:mode=author-in-text&locator=62");
    expect(note).toContain("#cite:mode=suppress-author&locator=3");
    expect(note).toContain(
      "[[literatures/wallgren-petterssonDistalMyopathyCaused2007]]; [[literatures/yinClinicopathologicalFeaturesMutational2021#cite:locator=3]]",
    );
    expect(note).toContain("[@wittNebulinRegulatesThin2006, p. 4]");
    expect(note).toContain("[[literature-note-citation-test]]");
  });

  it("resolves every generated Literature Note through the database", async () => {
    const items = ITEMS.filter(({ libraryID }) => libraryID === 1);
    expect(await readdir(join(layout.vaultDir, "literatures"))).toEqual(
      items
        .filter(
          ({ literatureNoteProfile }) => literatureNoteProfile === undefined,
        )
        .map(({ key, literatureNoteName }) => `${literatureNoteName ?? key}.md`)
        .sort(),
    );

    using db = openClient();
    const indexedKeys = new Set(indexedItems(db, 1).map(({ key }) => key));
    const citationKeys = new Map(
      getCitekeysByLibrary(db, 1).map(({ itemID, citekey }) => [
        itemID,
        citekey,
      ]),
    );

    for (const item of items) {
      const note = await readFile(
        join(
          layout.vaultDir,
          item.literatureNoteProfile === undefined ? "literatures" : "books",
          `${item.literatureNoteName ?? item.key}.md`,
        ),
        "utf-8",
      );

      expect(indexedKeys.has(item.key)).toBe(true);
      expect(note).toContain(`zotero-key: ${item.key}`);
      expect(citationKeys.get(item.itemID) ?? null).toBe(item.citationKey);
      expect(note.includes("\ncitekey:")).toBe(item.citationKey !== null);
    }
  });

  it("stamps the Books Profile Literature Note and leaves the others bare", async () => {
    const stamped = await readFile(
      join(layout.vaultDir, "books", "books-duplicateWithin2020.md"),
      "utf-8",
    );
    const unstamped = await readFile(
      join(layout.vaultDir, "literatures", "AAAAAAAA.md"),
      "utf-8",
    );

    expect(await readdir(join(layout.vaultDir, "books"))).toEqual([
      "books-duplicateWithin2020.md",
    ]);
    expect(stamped).toContain("zotlit-profile: Books (V1StGXR8Z5jd)");
    expect(unstamped).not.toContain("zotlit-profile:");
  });

  it("resolves every positive prose-page target to a generated Item", async () => {
    const targets = [
      {
        name: "Hensher2011",
        key: "HENSHR22",
        citationKey: "Hensher2011",
      },
      {
        name: "wallgren-petterssonDistalMyopathyCaused2007",
        key: "WALLGR27",
        citationKey: "wallgren-petterssonDistalMyopathyCaused2007",
      },
      {
        name: "wangMutationalClinicalSpectrum2020a",
        key: "WANGMT22",
        citationKey: "wangMutationalClinicalSpectrum2020a",
      },
      {
        name: "wittNebulinRegulatesThin2006",
        key: "WTTTNB26",
        citationKey: "wittNebulinRegulatesThin2006",
      },
      {
        name: "xuNoCitationKeyProperty2019",
        key: "XUNPKEY9",
        citationKey: null,
      },
      {
        name: "yinClinicopathologicalFeaturesMutational2021",
        key: "YXNCLN22",
        citationKey: "yinClinicopathologicalFeaturesMutational2021",
      },
    ] as const;
    using db = openClient();
    const citationKeys = getCitekeysByLibrary(db, 1);

    for (const target of targets) {
      const note = await readFile(
        join(layout.vaultDir, "literatures", `${target.name}.md`),
        "utf-8",
      );

      expect(note).toContain(`zotero-key: ${target.key}`);
      expect(note.includes("citekey:")).toBe(target.citationKey !== null);
      expect(
        citationKeys.some(
          ({ citekey }) => citekey === (target.citationKey ?? target.name),
        ),
      ).toBe(target.citationKey !== null);
    }
  });

  it("mirrors every Child Note under its resolvable Indexed Key", async () => {
    using db = openClient();
    const childNotes = NOTES.filter((note) => note.parentItemID !== null);
    const refs = getNoteRefsByItemIDs(
      db,
      childNotes.map(({ itemID }) => itemID),
    );

    expect(await readdir(join(layout.vaultDir, "zotero_notes"))).toEqual(
      refs.map(({ indexedKey }) => `${indexedKey}.md`).sort(),
    );
    for (const ref of refs) {
      const mirror = await readFile(
        join(layout.vaultDir, "zotero_notes", `${ref.indexedKey}.md`),
        "utf-8",
      );

      expect(mirror).toContain(`zotero-note-key: ${ref.indexedKey}`);
      expect(mirror).toContain("zotero-lastmod:");
      expect(mirror).toContain(`# ${ref.title}`);
      expect(mirror).not.toContain("<div data-schema-version");
    }
  });

  it("links every present Attachment from its generated Literature Note", async () => {
    using db = openClient();
    const attachments = getAttachmentsByParents(db, ATTACHMENT_PARENT_IDS);

    for (const attachment of attachments) {
      const parent = ITEMS.find(
        ({ itemID }) => itemID === attachment.parentItemID,
      )!;
      const note = await readFile(
        join(
          layout.vaultDir,
          "literatures",
          `${parent.literatureNoteName ?? parent.key}.md`,
        ),
        "utf-8",
      );
      const path = attachmentAbsPath(attachment, {
        dataDir: layout.dataDir,
        baseAttachmentPath: null,
      });

      if (path === null || attachment.key === "MISSNG22") continue;
      expect(note).toContain(pathToFileURL(path).href);
    }
  });

  it("enables the committed Hot Reload plugin for dev builds", async () => {
    const configDir = join(layout.vaultDir, ".obsidian");

    expect(
      JSON.parse(
        await readFile(join(configDir, "community-plugins.json"), "utf-8"),
      ),
    ).toEqual(["hot-reload"]);
    await expect(
      stat(join(configDir, "plugins", "hot-reload", "main.js")),
    ).resolves.toBeDefined();
  });

  it("points at the fixture data directory through the fixture profile", async () => {
    const prefs = await readFile(join(layout.profileDir, "prefs.js"), "utf-8");

    expect(prefs).toContain(JSON.stringify(layout.dataDir));
    expect(prefs).toContain("extensions.zotero.useDataDir");
  });

  it("installs the bundled CSL styles a Paired Zotero would unpack", async () => {
    const stylesDir = join(layout.dataDir, "styles");
    const names = await readdir(stylesDir);

    // The style the Citation and References Style picker offers as Default is
    // the one a styleless data directory would leave as the only choice.
    expect(names).toContain("chicago-author-date.csl");
    expect(
      names.filter((name) => name.endsWith(".csl")).length,
    ).toBeGreaterThan(1);
    expect(
      await readFile(join(stylesDir, "chicago-author-date.csl"), "utf-8"),
    ).toContain("<id>http://www.zotero.org/styles/chicago-author-date</id>");
  });

  it("installs the Fixture Spec's user-installed styles beside the bundled set", async () => {
    const stylesDir = join(layout.dataDir, "styles");
    const names = await readdir(stylesDir);

    for (const style of INSTALLED_STYLES) {
      expect(names).toContain(style.file);
      const xml = await readFile(join(stylesDir, style.file), "utf-8");
      expect(xml).toContain(`<id>${style.id}</id>`);
      expect(xml).toContain(`<title>${style.title}</title>`);
    }
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

  it("preserves the Fixture Spec's native Citation Keys", async () => {
    const prefs = await readFile(join(layout.profileDir, "prefs.js"), "utf-8");

    for (const line of BETTER_BIBTEX_PREFS) expect(prefs).toContain(line);
  });

  it("keeps the shipped network-port defaults without port overrides", async () => {
    const prefs = await readFile(join(layout.profileDir, "prefs.js"), "utf-8");
    const data = JSON.parse(
      await readFile(layout.pluginDataPath, "utf-8"),
    ) as Record<string, unknown>;

    expect(prefs).not.toContain("extensions.zotlit.notify-url");
    expect(prefs).not.toContain('extensions.zotlit.notify"');
    expect(prefs).not.toContain("extensions.zotero.httpServer.port");
    expect(data).not.toHaveProperty("server.port");
  });

  it("points the vault and the Companion at one given Live Updates port", async () => {
    const portedLayout = getFixtureLayout(
      await mkdtemp(join(dirname(layout.root), "fixture-test-port-")),
    );
    fixture.defer(() =>
      rm(portedLayout.root, { recursive: true, force: true }),
    );
    await buildFixture(portedLayout, {
      liveUpdatePort: 54_321,
      zoteroHttpPort: 54_322,
    });

    const prefs = await readFile(
      join(portedLayout.profileDir, "prefs.js"),
      "utf-8",
    );
    const data = JSON.parse(
      await readFile(portedLayout.pluginDataPath, "utf-8"),
    ) as Record<string, unknown>;

    expect(data["server.port"]).toBe(54_321);
    expect(data["server.enabled"]).toBe(true);
    expect(prefs).toContain('user_pref("extensions.zotlit.notify", true);');
    expect(prefs).toContain(
      'user_pref("extensions.zotlit.notify-url", "http://127.0.0.1:54321");',
    );
    expect(prefs).toContain(
      'user_pref("extensions.zotero.httpServer.port", 54322);',
    );
  });

  it("keeps the generated settings over a bundle folder's own data.json", async () => {
    // A Paired Run passes the Development Vault's plugin folder as the bundle,
    // and ZotLit saves its settings there while the vault runs.
    const bundleDir = await mkdtemp(join(dirname(layout.root), "bundle-"));
    fixture.defer(() => rm(bundleDir, { recursive: true, force: true }));
    await writeFile(join(bundleDir, "main.js"), "// stale bundle\n");
    await writeFile(
      join(bundleDir, "data.json"),
      JSON.stringify({ __VERSION__: 9, "server.port": 9091, stale: true }),
    );
    const bundledLayout = getFixtureLayout(
      await mkdtemp(join(dirname(layout.root), "fixture-test-bundle-")),
    );
    fixture.defer(() =>
      rm(bundledLayout.root, { recursive: true, force: true }),
    );

    await buildFixture(bundledLayout, {
      pluginBundleDir: bundleDir,
      liveUpdatePort: 54_322,
    });

    const data = JSON.parse(
      await readFile(bundledLayout.pluginDataPath, "utf-8"),
    ) as Record<string, unknown>;
    expect(data["server.port"]).toBe(54_322);
    expect(data).not.toHaveProperty("stale");
    await expect(
      readFile(join(bundledLayout.pluginDir, "main.js"), "utf-8"),
    ).resolves.toBe("// stale bundle\n");
  });

  it("saves a Library Scope the plugin can load", async () => {
    const data = JSON.parse(
      await readFile(layout.pluginDataPath, "utf-8"),
    ) as Record<string, unknown>;

    expect(data.__VERSION__).toBe(10);
    expect(data["note.default-profile"]).toEqual({
      bindings: {
        "note.literature-folder": "literatures",
        "citation.references-style": null,
        "note.import-folder": "zotero_notes",
        "note.import-colored-highlights": false,
        "note.import-annotations-as-template": false,
      },
    });
    expect(data[LIBRARY_SCOPE_SETTING_KEY]).toEqual({ mode: "all" });
  });

  it("saves the Fixture's document-backed Literature Note Profile", async () => {
    const data = JSON.parse(
      await readFile(layout.pluginDataPath, "utf-8"),
    ) as Record<string, unknown>;

    expect(data).not.toHaveProperty("note.profiles");
    const source = await readFile(
      join(layout.vaultDir, "templates", "zotlit-profile.books.md"),
      "utf-8",
    );
    expect(source).toContain("id: V1StGXR8Z5jd");
    expect(source).toContain("name: Books");
    expect(source).toContain("folder: books");
    expect(source).toContain(
      "citationStyle: http://www.zotero.org/styles/chinese-gb7714-1987-numeric",
    );
  });

  it("writes Managed Frontmatter into the Fixture Profile document", async () => {
    const document = await readFile(
      join(layout.vaultDir, "templates", "zotlit-profile.books.md"),
      "utf-8",
    );

    expect(document).toContain(`frontmatter:
  - key: fixture-title
    expr: zt.title
    merge: replace`);
    expect(document).toContain(`  - key: fixture-kind
    value: {"$if":"zt.itemType == 'journalArticle'","then":"reference/article","else":"reference/other"}
    merge: replace`);
    expect(document).toContain(`  - key: fixture-obsolete
    value: {"$if":"zt.itemType == 'bookSection'","then":"retained"}
    merge: replace`);
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

describe("a Vault Case", () => {
  async function buildVaultCase(vaultCase: string): Promise<FixtureLayout> {
    const caseLayout = getFixtureLayout(
      await mkdtemp(join(dirname(layout.root), `fixture-test-${vaultCase}-`)),
    );
    fixture.defer(() => rm(caseLayout.root, { recursive: true, force: true }));
    // A stale bundle folder stands in for a Development Vault's plugin folder,
    // whose data.json holds whatever ZotLit last saved there.
    const bundleDir = await mkdtemp(join(dirname(layout.root), "bundle-"));
    fixture.defer(() => rm(bundleDir, { recursive: true, force: true }));
    await writeFile(join(bundleDir, "main.js"), "// stale bundle\n");
    await writeFile(
      join(bundleDir, "data.json"),
      JSON.stringify({ __VERSION__: 10, stale: true }),
    );
    await buildFixture(caseLayout, { vaultCase, pluginBundleDir: bundleDir });
    return caseLayout;
  }

  it("names the configured, fresh, and upgrader cases", () => {
    expect(VAULT_CASES.map((vaultCase) => vaultCase.id)).toEqual([
      "configured",
      "fresh",
      "upgrader",
    ]);
  });

  it("leaves a fresh vault with ZotLit enabled and nothing else", async () => {
    const fresh = await buildVaultCase("fresh");

    // `attachments` holds the vault-backed linked-file Attachment the Zotero
    // data references: a file the user keeps in the vault, not ZotLit state.
    expect(await readdir(fresh.vaultDir)).toEqual([".obsidian", "attachments"]);
    expect(
      JSON.parse(
        await readFile(
          join(fresh.vaultDir, ".obsidian", "community-plugins.json"),
          "utf-8",
        ),
      ),
    ).toEqual(["hot-reload", "zotlit"]);
    await expect(
      readFile(join(fresh.pluginDir, "main.js"), "utf-8"),
    ).resolves.toBe("// stale bundle\n");
    await expect(stat(fresh.pluginDataPath)).rejects.toThrow("ENOENT");
  });

  it("refuses a fresh vault with a saved Library Scope", async () => {
    const caseLayout = getFixtureLayout(
      await mkdtemp(join(dirname(layout.root), "fixture-test-fresh-scope-")),
    );
    fixture.defer(() => rm(caseLayout.root, { recursive: true, force: true }));

    await expect(
      buildFixture(caseLayout, { vaultCase: "fresh", scopeCase: "partial" }),
    ).rejects.toThrow('cannot save the "partial" Scope Case');
  });

  it("writes the v2.1 settings shape into an upgrader vault", async () => {
    const upgrader = await buildVaultCase("upgrader");
    const data = JSON.parse(
      await readFile(upgrader.pluginDataPath, "utf-8"),
    ) as Record<string, unknown>;

    expect(data).toEqual({
      __VERSION__: 9,
      "note.literature-folder": "literatures",
      "note.import-folder": "zotero_notes",
      "note.frontmatter-fields": UPGRADER_FRONTMATTER_FIELDS,
      "release.previous-version": "2.1.0",
      "server.enabled": true,
      [LIBRARY_SCOPE_SETTING_KEY]: { mode: "all" },
    });
    expect(UPGRADER_FRONTMATTER_FIELDS.map((field) => field.key)).toEqual([
      "title",
      "related",
      "collections",
      "citekey",
      "year",
    ]);
  });

  it("ejects every legacy slot file with its visible edit, and no Profile document", async () => {
    const upgrader = await buildVaultCase("upgrader");
    const templates = join(upgrader.vaultDir, "templates");

    expect((await readdir(templates)).sort()).toEqual(
      [
        "zotlit-annotation.liquid.md",
        "zotlit-content.liquid.md",
        "zotlit-filename.liquid.md",
        "zotlit-note.liquid.md",
      ].sort(),
    );
    for (const template of UPGRADER_LEGACY_TEMPLATES) {
      const source = await readFile(
        join(templates, legacyTemplateFilename(template)),
        "utf-8",
      );
      expect(source).toBe(await legacyTemplateSource(template));
      expect(source).toContain(template.replace);
    }
    // The v2.1 vault has no Profiles, so the Books Profile note it seeds is
    // one more unstamped note in the single literature folder.
    expect(
      (await readdir(join(upgrader.vaultDir, "literatures"))).sort(),
    ).toEqual(
      [
        ...(await readdir(join(layout.vaultDir, "literatures"))),
        "books-duplicateWithin2020.md",
      ].sort(),
    );
    expect(await readdir(upgrader.vaultDir)).not.toContain("books");
  });

  it("fails when a shipped default drifts away from its edit", async () => {
    await expect(
      legacyTemplateSource({
        name: "note",
        find: "text the default note template never held",
        replace: "",
      }),
    ).rejects.toThrow("update UPGRADER_LEGACY_TEMPLATES");
  });
});
