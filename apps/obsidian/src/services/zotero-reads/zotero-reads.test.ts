import { Effect, Exit, Fiber, Layer, PubSub, Scope, Stream } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  buildNoteContextFromSource,
  getIndexedItemIDsByLibrary,
  getIndexSignature,
} from "@zotlit/db";
import type { NoteResolvers } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { createFixtureSchema } from "@zotlit/db/test-utils";
import { exportItemSnapshot } from "@zotlit/workbench/snapshot";

import { layerRcRef } from "./connection";
import { Connection } from "./connection";
import type { ConnectionOpener } from "./connection";
import type { HandlersOptions } from "./handlers";
import { makeInProcessClient } from "./in-process";
import type { ZoteroReadsClient } from "./in-process";
import { DbUnavailable, SnapshotExpired, SnapshotId } from "./rpc";
import type { ChangeEvent, ReadsConfig } from "./rpc";
import { inProcessReadsService, sharedClientOpener } from "./test-utils";

/**
 * Rows every contract test reads: a user library (1) and a group library (2,
 * group 900). MAIN2345 has an attachment with two annotations, a child note,
 * two related items, tags, and a collection; GRPITEMS lives in the group.
 */
const SEED = `
  insert into version (schema, version) values ('userdata', 129);
  insert into libraries (libraryID, type, version, clientVersion)
    values (1, 'user', 7, 3), (2, 'group', 4, 2);
  insert into groups (groupID, libraryID, name) values (900, 2, 'Lab');
  insert into settings (setting, key, value)
    values ('account', 'userID', 42), ('account', 'username', 'reader');

  insert into itemTypes (itemTypeID, typeName)
    values (1, 'journalArticle'), (2, 'attachment'), (3, 'note'),
           (4, 'annotation'), (5, 'book');

  insert into fieldsCombined (fieldID, fieldName, custom)
    values (10, 'title', 0), (11, 'citationKey', 0), (12, 'date', 0),
           (13, 'shortTitle', 0);

  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values
      (1, 1, '2024-01-01 00:00:00', '2024-02-01 00:00:00', 1, 'MAIN2345'),
      (2, 5, '2024-01-01 00:00:00', '2024-01-02 00:00:00', 1, 'RELB2345'),
      (3, 1, '2024-01-01 00:00:00', '2024-01-03 00:00:00', 1, 'RELA2345'),
      (10, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATCH2345'),
      (100, 4, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNT2345'),
      (101, 4, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNT2346'),
      (200, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'NTE22345'),
      (300, 1, '2024-01-01 00:00:00', '2024-01-04 00:00:00', 2, 'GRPITEMS');

  insert into itemDataValues (valueID, value)
    values (1, 'Main Study'), (2, 'Beta Book'), (3, 'Alpha Paper'),
           (4, 'main2024'), (5, '2024-05-06'), (6, 'Group Work'),
           (7, 'Main');
  insert into itemData (itemID, fieldID, valueID)
    values (1, 10, 1), (1, 11, 4), (1, 12, 5), (1, 13, 7),
           (2, 10, 2), (3, 10, 3), (300, 10, 6);

  insert into creators (creatorID, firstName, lastName, fieldMode)
    values (1, 'Ada', 'Lovelace', 0);
  insert into creatorTypes (creatorTypeID, creatorType) values (1, 'author');
  insert into itemCreators (itemID, creatorID, creatorTypeID, orderIndex)
    values (1, 1, 1, 0);
  insert into itemTypeCreatorTypes (itemTypeID, creatorTypeID, primaryField)
    values (1, 1, 1);

  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values (10, 1, 0, 'application/pdf', 'storage:paper.pdf');
  insert into itemAnnotations (
    itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex,
    position, isExternal
  )
    values
      (100, 10, 1, 'excerpt', '<i>excerpt</i>', '#ffd400', '1',
       '00000|000000|00000', '{"pageIndex":0,"rects":[[0,0,1,1]]}', 0),
      (101, 10, 3, null, null, '#ffd400', '1',
       '00000|000001|00000', '{"pageIndex":0,"rects":[[0,0,1,1]]}', 0);
  insert into itemNotes (itemID, parentItemID, note, title)
    values (200, 1, '<p>body</p>', 'Methods');

  insert into tags (tagID, name) values (1, 'zt'), (2, 'method'), (3, 'claim');
  insert into itemTags (itemID, tagID, type)
    values (1, 1, 0), (2, 2, 0), (100, 3, 0);

  insert into relationPredicates (predicateID, predicate)
    values (1, 'dc:relation');
  insert into itemRelations (itemID, predicateID, object)
    values
      (1, 1, 'http://zotero.org/users/local/AAAAAAAA/items/RELB2345'),
      (1, 1, 'http://zotero.org/users/local/AAAAAAAA/items/RELA2345');

  insert into collections (collectionID, collectionName, libraryID, key)
    values (500, 'Reading', 1, 'CLL22345');
  insert into collectionItems (collectionID, itemID) values (500, 1), (500, 2);
`;

/**
 * An opener over fresh `:memory:` databases. Each open gets the next number;
 * the log records opens and closes, so a test can watch a connection's
 * lifetime, and `closed(n)` completes when connection #n closes. Open #N
 * reports library 1 at `version: N`, so a read shows which connection
 * answered. `statements()` counts the statements run on every connection;
 * `ran(sql, open?)` counts the runs of one statement, on connection #open
 * or on any. `extra` adds SQL per open, or `null` to fail the open.
 */
function fixtureOpener(extra: (open: number) => string | null = () => "") {
  const log: string[] = [];
  const configs: (ReadsConfig | null)[] = [];
  const closes = new Map<number, PromiseWithResolvers<void>>();
  const closeSignal = (id: number) => {
    let signal = closes.get(id);
    if (!signal) {
      signal = Promise.withResolvers<void>();
      closes.set(id, signal);
    }
    return signal;
  };
  let opened = 0;
  let statements = 0;
  const runs: { open: number; sql: string }[] = [];
  const open: ConnectionOpener = (config) => {
    const id = ++opened;
    configs.push(config);
    const sql = extra(id);
    if (sql === null) throw new Error(`source #${id} is not readable`);
    const client: NodeDatabaseClient = createClient(":memory:");
    const sqlite = client.$client;
    createFixtureSchema(sqlite);
    sqlite.exec(SEED);
    sqlite.exec(
      `update libraries set version = ${id} where libraryID = 1; ${sql}`,
    );
    const prepare = sqlite.prepare.bind(sqlite);
    sqlite.prepare = (source: string) => {
      const statement = prepare(source);
      const methods = statement as unknown as Record<
        "all" | "get" | "run" | "iterate",
        (...args: unknown[]) => unknown
      >;
      for (const method of ["all", "get", "run", "iterate"] as const) {
        const run = methods[method].bind(statement);
        methods[method] = (...args) => {
          statements += 1;
          runs.push({ open: id, sql: source });
          return run(...args);
        };
      }
      return statement;
    };
    const close = sqlite.close.bind(sqlite);
    sqlite.close = () => {
      log.push(`close #${id}`);
      close();
      closeSignal(id).resolve();
    };
    log.push(`open #${id}`);
    return client;
  };
  return {
    open,
    log,
    configs,
    closed: (id: number) => Effect.promise(() => closeSignal(id).promise),
    statements: () => statements,
    ran: (sql: string, open?: number) =>
      runs.filter(
        (entry) =>
          entry.sql === sql && (open === undefined || entry.open === open),
      ).length,
  };
}

/** Run `body` against an in-process client over `opener`. */
function withReads<A, E>(
  opener: ConnectionOpener,
  body: (
    reads: ZoteroReadsClient,
  ) => Effect.Effect<A, E, Connection | Scope.Scope>,
  options?: HandlersOptions,
): Promise<A> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const reads = yield* makeInProcessClient(options);
      return yield* body(reads);
    }).pipe(Effect.scoped, Effect.provide(layerRcRef(opener))),
  );
}

/** The library-1 version a read saw: which connection answered. */
const connectionSeen = (reads: ZoteroReadsClient, snapshot?: SnapshotId) =>
  Effect.map(
    reads.Libraries(snapshot === undefined ? {} : { snapshot }),
    (libraries) => libraries.find((l) => l.libraryID === 1)!.version,
  );

/** Pull from `pull` until `n` elements arrived, whatever the chunking. */
const take = <A, E>(
  pull: Effect.Effect<readonly A[], E | import("effect").Cause.Done>,
  n: number,
) =>
  Effect.gen(function* () {
    const out: A[] = [];
    while (out.length < n) out.push(...(yield* pull));
    return out;
  });

const noteResolvers: NoteResolvers = {
  item: {
    notePath: (item) => `notes/${item.indexedKey}.md`,
    noteLink: (item) => `[[notes/${item.indexedKey}]]`,
    authorsShort: (item) => `short:${item.key}`,
  },
  annotation: {
    filePath: (attachment) => `/abs/${attachment.key}`,
    fileLink: (attachment) => () => `[[${attachment.key}]]`,
    annotationImageLink: () => null,
    commentToMarkdown: (html) => `md(${html})`,
    authorsShort: (item) => `short:${item.key}`,
  },
  resolveChildNote: (note) => ({
    key: note.key,
    indexedKey: note.indexedKey,
    title: note.title,
    noteLink: () => `[[${note.key}]]`,
  }),
};

describe("ZoteroReads operations", () => {
  it("Libraries lists every library with its group", async () => {
    const { open } = fixtureOpener();
    const libraries = await withReads(open, (reads) => reads.Libraries({}));
    expect(libraries).toEqual([
      {
        libraryID: 1,
        type: "user",
        version: 1,
        clientVersion: 3,
        groupID: null,
        name: null,
      },
      {
        libraryID: 2,
        type: "group",
        version: 4,
        clientVersion: 2,
        groupID: 900,
        name: "Lab",
      },
    ]);
  });

  it("ConnectionReadout counts top-level items across every library", async () => {
    const { open } = fixtureOpener();
    const readout = await withReads(open, (reads) =>
      reads.ConnectionReadout({}),
    );
    expect(readout).toEqual({ itemCount: 4 });
  });

  it("IndexItems streams the library in slices, with Instants decoded", async () => {
    const { open } = fixtureOpener();
    const slices = await withReads(
      open,
      (reads) => Stream.runCollect(reads.IndexItems({ libraryID: 1 })),
      { sliceSize: 2 },
    );
    expect(slices.map((slice) => slice.map((item) => item.key))).toEqual([
      ["MAIN2345", "RELA2345"],
      ["RELB2345"],
    ]);
    const main = slices[0]![0]!;
    expect(main.dateModified).toBeInstanceOf(Temporal.Instant);
    expect(main.dateModified.toString()).toBe("2024-02-01T00:00:00Z");
    expect(main).toMatchObject({
      indexedKey: "MAIN2345",
      title: "Main Study",
      citationKey: "main2024",
      primaryCreator: { firstName: "Ada", lastName: "Lovelace", fieldMode: 0 },
    });
  });

  it("ItemsByIndexedKeys answers user and group keys and leaves unknown keys out", async () => {
    const { open } = fixtureOpener();
    const items = await withReads(open, (reads) =>
      reads.ItemsByIndexedKeys({
        indexedKeys: ["MAIN2345", "GRPITEMSg900", "MISS2345", "GRPITEMSg1"],
      }),
    );
    expect([...items.keys()]).toEqual(["MAIN2345", "GRPITEMSg900"]);
    const main = items.get("MAIN2345")!;
    expect(main.dateAdded.toString()).toBe("2024-01-01T00:00:00Z");
    expect(main.customFields).toBeInstanceOf(Map);
    expect(main.fields).toMatchObject({
      itemType: "journalArticle",
      title: "Main Study",
    });
    expect(main.creators).toEqual([
      {
        firstName: "Ada",
        lastName: "Lovelace",
        creatorType: "author",
        fieldMode: 0,
      },
    ]);
    expect(items.get("GRPITEMSg900")).toMatchObject({
      libraryID: 2,
      groupID: 900,
    });
  });

  it("ItemFamily returns related items and child notes", async () => {
    const { open } = fixtureOpener();
    const [family, unknown] = await withReads(open, (reads) =>
      Effect.all([
        reads.ItemFamily({ itemID: 1 }),
        reads.ItemFamily({ itemID: 999 }),
      ]),
    );
    expect(family.relatedItems.map((item) => item.key).sort()).toEqual([
      "RELA2345",
      "RELB2345",
    ]);
    expect(family.childNotes).toMatchObject([
      { key: "NTE22345", title: "Methods", parentItemID: 1 },
    ]);
    expect(family.childNotes[0]!.dateModified).toBeInstanceOf(Temporal.Instant);
    expect(unknown).toEqual({ relatedItems: [], childNotes: [] });
  });

  it("NoteSource returns a bundle the renderer builds into the note context", async () => {
    const { open } = fixtureOpener();
    const [source, missing] = await withReads(open, (reads) =>
      Effect.all([
        reads.NoteSource({ itemID: 1 }),
        reads.NoteSource({ itemID: 999 }),
      ]),
    );
    expect(missing).toBeNull();
    expect(source!.username).toBe("reader");
    expect(
      source!.annotationsByAttachment.get(10)![0]!.dateAdded,
    ).toBeInstanceOf(Temporal.Instant);

    const ctx = buildNoteContextFromSource(source!, noteResolvers);
    expect(ctx.title).toBe("Main Study");
    expect(ctx.weblink).toBe("https://www.zotero.org/reader/items/MAIN2345");
    expect(ctx.tags.map(String)).toEqual(["zt"]);
    expect(ctx.collections.map(String)).toEqual(["Reading"]);
    expect(ctx.attachments.map((a) => a.key)).toEqual(["ATCH2345"]);
    expect(ctx.annotations.map((a) => a.key)).toEqual(["ANNT2345", "ANNT2346"]);
    expect(ctx.annotations[0]!.tags.map(String)).toEqual(["claim"]);
    expect(ctx.relatedItems.map((r) => r.title)).toEqual([
      "Alpha Paper",
      "Beta Book",
    ]);
    expect(ctx.notes.map((n) => n.key)).toEqual(["NTE22345"]);
  });

  it("NoteSource takes the caller's username over the signed-in account", async () => {
    const { open } = fixtureOpener();
    const source = await withReads(open, (reads) =>
      reads.NoteSource({ itemID: 1, username: null }),
    );
    expect(source!.username).toBeNull();
  });

  it("AnnotationSources returns annotations by key with their attachment, parent item, and tags", async () => {
    const { open } = fixtureOpener();
    const sources = await withReads(open, (reads) =>
      reads.AnnotationSources({ libraryID: 1, keys: ["ANNT2345", "MISS2345"] }),
    );
    expect(sources.annotations.map((a) => a.key)).toEqual(["ANNT2345"]);
    expect(sources.annotations[0]!.position).toEqual({
      pageIndex: 0,
      rects: [[0, 0, 1, 1]],
    });
    expect(sources.attachments.map((a) => a.key)).toEqual(["ATCH2345"]);
    expect(sources.parentItems.map((i) => i.key)).toEqual(["MAIN2345"]);
    expect(sources.tagsByItemID.get(100)!.map((tag) => tag.tag.name)).toEqual([
      "claim",
    ]);
    expect(sources.username).toBe("reader");
  });

  it("AnnotationsOfAttachment returns the attachment's annotations and the account user", async () => {
    const { open } = fixtureOpener();
    const [found, unknown] = await withReads(open, (reads) =>
      Effect.all([
        reads.AnnotationsOfAttachment({ attachmentKey: "ATCH2345" }),
        reads.AnnotationsOfAttachment({ attachmentKey: "MISS2345" }),
      ]),
    );
    expect(found.attachment).toMatchObject({
      key: "ATCH2345",
      contentType: "application/pdf",
    });
    expect(found.annotations.map((a) => [a.key, a.type])).toEqual([
      ["ANNT2345", 1],
      ["ANNT2346", 3],
    ]);
    expect(found.accountUserID).toBe(42);
    expect(unknown).toEqual({
      attachment: null,
      annotations: [],
      accountUserID: 42,
    });
  });

  it("AttachmentsOf lists the attachments of the given items", async () => {
    const { open } = fixtureOpener();
    const attachments = await withReads(open, (reads) =>
      reads.AttachmentsOf({ itemIDs: [1, 2] }),
    );
    expect(attachments).toMatchObject([
      {
        key: "ATCH2345",
        parentItemID: 1,
        path: "storage:paper.pdf",
        linkMode: 0,
      },
    ]);
    expect(attachments[0]!.dateModified).toBeInstanceOf(Temporal.Instant);
  });

  it("DisplayRefs streams one entry per id, null for an id with no live item", async () => {
    const { open } = fixtureOpener();
    const slices = await withReads(
      open,
      (reads) =>
        Stream.runCollect(reads.DisplayRefs({ itemIDs: [1, 300, 999] })),
      { sliceSize: 2 },
    );
    expect(slices).toEqual([
      [
        {
          itemID: 1,
          ref: {
            itemID: 1,
            libraryID: 1,
            key: "MAIN2345",
            groupID: null,
            indexedKey: "MAIN2345",
            title: "Main Study",
          },
        },
        {
          itemID: 300,
          ref: {
            itemID: 300,
            libraryID: 2,
            key: "GRPITEMS",
            groupID: 900,
            indexedKey: "GRPITEMSg900",
            title: "Group Work",
          },
        },
      ],
      [{ itemID: 999, ref: null }],
    ]);
  });

  it("NoteBodies returns notes with their bodies and leaves unknown keys out", async () => {
    const { open } = fixtureOpener();
    const notes = await withReads(open, (reads) =>
      reads.NoteBodies({ libraryID: 1, keys: ["NTE22345", "MISS2345"] }),
    );
    expect(notes).toMatchObject([
      { key: "NTE22345", note: "<p>body</p>", title: "Methods" },
    ]);
    expect(notes[0]!.dateAdded).toBeInstanceOf(Temporal.Instant);
  });

  it("WorkLabels returns label inputs for top-level items only", async () => {
    const { open } = fixtureOpener();
    const labels = await withReads(open, (reads) =>
      reads.WorkLabels({ indexedKeys: ["MAIN2345", "ATCH2345", "MISS2345"] }),
    );
    expect([...labels]).toEqual([
      [
        "MAIN2345",
        {
          libraryID: 1,
          creators: [
            {
              firstName: "Ada",
              lastName: "Lovelace",
              creatorType: "author",
              fieldMode: 0,
            },
          ],
          primaryCreatorType: "author",
          title: "Main Study",
          shortTitle: "Main",
          date: "2024-05-06",
        },
      ],
    ]);
  });

  it("AttachmentPathIndex streams every attachment beside its parent key, a slice per query", async () => {
    const { open } = fixtureOpener(
      () => `
        insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
          values (11, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATCHSOLO');
        insert into itemAttachments (itemID, parentItemID, linkMode, path)
          values (11, null, 0, 'storage:loose.pdf');
      `,
    );
    const slices = await withReads(
      open,
      (reads) => Stream.runCollect(reads.AttachmentPathIndex({})),
      { sliceSize: 1 },
    );
    expect(
      slices.map((slice) =>
        slice.map((attachment) => [
          attachment.key,
          attachment.parentIndexedKey,
          attachment.path,
        ]),
      ),
    ).toEqual([
      [["ATCH2345", "MAIN2345", "storage:paper.pdf"]],
      [["ATCHSOLO", null, "storage:loose.pdf"]],
    ]);
  });

  it("CitekeySnapshot streams the citation keys of one library, a slice per query", async () => {
    const { open } = fixtureOpener(
      () => `
        insert into itemDataValues (valueID, value) values (40, 'rela2024');
        insert into itemData (itemID, fieldID, valueID) values (3, 11, 40);
      `,
    );
    const slices = await withReads(
      open,
      (reads) => Stream.runCollect(reads.CitekeySnapshot({ libraryID: 1 })),
      { sliceSize: 1 },
    );
    expect(slices).toEqual([
      [
        {
          itemID: 1,
          libraryID: 1,
          key: "MAIN2345",
          indexedKey: "MAIN2345",
          citekey: "main2024",
        },
      ],
      [
        {
          itemID: 3,
          libraryID: 1,
          key: "RELA2345",
          indexedKey: "RELA2345",
          citekey: "rela2024",
        },
      ],
    ]);
  });

  it("IndexSignature counts and checksums the top-level items of one library", async () => {
    const { open } = fixtureOpener();
    const signatures = await withReads(open, (reads) =>
      Effect.all([
        reads.IndexSignature({ libraryID: 1 }),
        reads.IndexSignature({ libraryID: 2 }),
        reads.IndexSignature({ libraryID: 99 }),
      ]),
    );
    // Seconds of each dateModified plus the itemID, summed per library.
    expect(signatures).toEqual([
      { count: 3, checksum: 1706745601 + 1704153602 + 1704240003 },
      { count: 1, checksum: 1704326700 },
      { count: 0, checksum: 0 },
    ]);
  });

  it("AttachmentsByKeys returns one library's attachments by key and leaves unknown keys out", async () => {
    const { open } = fixtureOpener(
      () => `
        insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
          values (201, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'IMGE2345');
        insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
          values (201, 200, 0, 'image/png', 'storage:figure.png');
      `,
    );
    const [found, otherLibrary] = await withReads(open, (reads) =>
      Effect.all([
        reads.AttachmentsByKeys({
          libraryID: 1,
          keys: ["IMGE2345", "ATCH2345", "MISS2345"],
        }),
        reads.AttachmentsByKeys({ libraryID: 2, keys: ["IMGE2345"] }),
      ]),
    );
    expect(found.map((a) => [a.key, a.parentItemID, a.contentType])).toEqual([
      ["IMGE2345", 200, "image/png"],
      ["ATCH2345", 1, "application/pdf"],
    ]);
    expect(found[0]!.dateAdded).toBeInstanceOf(Temporal.Instant);
    expect(otherLibrary).toEqual([]);
  });

  it("DatabaseIdentity names the account and the Local API database", async () => {
    const { open } = fixtureOpener(
      () => `
        insert into settings (setting, key, value)
          values ('account', 'localUserKey', 'v3aG8nQf'),
                 ('localAPI', 'serverID', 'A8sf5Zsz8ySw');
      `,
    );
    const identity = await withReads(open, (reads) =>
      reads.DatabaseIdentity({}),
    );
    expect(identity).toEqual({
      userID: 42,
      localUserKey: "v3aG8nQf",
      serverID: "A8sf5Zsz8ySw",
    });
  });

  it("ItemSnapshot exports the same Item Snapshot as a direct export", async () => {
    const { open } = fixtureOpener();
    const options = {
      provenance: {
        kind: "connected",
        installationId: "install",
        vault: "Vault",
      },
      vaultTargets: { notes: { MAIN2345: "Literature/Main.md" } },
    } as const;
    const selection = {
      library: { type: "personal" },
      key: "MAIN2345",
    } as const;
    const snapshot = await withReads(open, (reads) =>
      reads.ItemSnapshot({ selection, ...options }),
    );

    const direct = createClient(":memory:");
    using _direct = { [Symbol.dispose]: () => direct.$client.close() };
    createFixtureSchema(direct.$client);
    direct.$client.exec(SEED);
    expect(snapshot).toEqual(exportItemSnapshot(direct, selection, options));
    expect(snapshot.item.title).toBe("Main Study");
  });

  it("ItemSnapshot fails with DbUnavailable for an Item outside the selected Library", async () => {
    const { open } = fixtureOpener();
    const error = await withReads(open, (reads) =>
      Effect.flip(
        reads.ItemSnapshot({
          selection: {
            library: { type: "group", groupID: 900 },
            key: "MAIN2345",
          },
          provenance: { kind: "sample", id: "x" },
        }),
      ),
    );
    expect(error).toBeInstanceOf(DbUnavailable);
  });

  it("ItemType names the type of any live Item, child Items included", async () => {
    const { open } = fixtureOpener();
    const types = await withReads(open, (reads) =>
      Effect.all([
        reads.ItemType({ indexedKey: "MAIN2345" }),
        reads.ItemType({ indexedKey: "ATCH2345" }),
        reads.ItemType({ indexedKey: "NTE22345" }),
        reads.ItemType({ indexedKey: "ANNT2345" }),
        reads.ItemType({ indexedKey: "GRPITEMSg900" }),
        reads.ItemType({ indexedKey: "MISS2345" }),
      ]),
    );
    expect(types).toEqual([
      { libraryID: 1, key: "MAIN2345", itemType: "journalArticle" },
      { libraryID: 1, key: "ATCH2345", itemType: "attachment" },
      { libraryID: 1, key: "NTE22345", itemType: "note" },
      { libraryID: 1, key: "ANNT2345", itemType: "annotation" },
      { libraryID: 2, key: "GRPITEMS", itemType: "journalArticle" },
      null,
    ]);
  });

  it("AnnotViewAttachments lists an item's attachments, or a standalone attachment alone, with annotation counts", async () => {
    const { open } = fixtureOpener(
      () => `
        insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
          values (11, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'LOOS2345');
        insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
          values (11, null, 0, 'application/pdf', 'storage:loose.pdf');
      `,
    );
    const [ofItem, standalone, unknown] = await withReads(open, (reads) =>
      Effect.all([
        reads.AnnotViewAttachments({
          libraryID: 1,
          key: "MAIN2345",
          standalone: false,
        }),
        reads.AnnotViewAttachments({
          libraryID: 1,
          key: "LOOS2345",
          standalone: true,
        }),
        reads.AnnotViewAttachments({
          libraryID: 1,
          key: "MISS2345",
          standalone: true,
        }),
      ]),
    );
    expect(ofItem).toEqual([
      {
        itemID: 10,
        indexedKey: "ATCH2345",
        path: "storage:paper.pdf",
        annotCount: 2,
      },
    ]);
    expect(standalone).toEqual([
      {
        itemID: 11,
        indexedKey: "LOOS2345",
        path: "storage:loose.pdf",
        annotCount: 0,
      },
    ]);
    expect(unknown).toEqual([]);
  });

  it("ReaderTargetKeys names a push's attachment, parent item, and live selected annotations", async () => {
    const { open } = fixtureOpener();
    const [named, unknown] = await withReads(open, (reads) =>
      Effect.all([
        reads.ReaderTargetKeys({ attachmentID: 10, selected: [101, 999] }),
        reads.ReaderTargetKeys({ attachmentID: 999, selected: [] }),
      ]),
    );
    expect(named).toEqual({
      attachmentKey: "ATCH2345",
      itemKey: "MAIN2345",
      selected: ["ANNT2346"],
    });
    expect(unknown).toBeNull();
  });

  it("ScopeItemIDs lists a library's or a collection's items or notes, null for an unknown collection", async () => {
    const { open } = fixtureOpener();
    const [items, filed, notes, unknown] = await withReads(open, (reads) =>
      Effect.all([
        reads.ScopeItemIDs({ kind: "literature-items", libraryID: 1 }),
        reads.ScopeItemIDs({
          kind: "literature-items",
          libraryID: 1,
          collectionKey: "CLL22345",
        }),
        reads.ScopeItemIDs({ kind: "notes", libraryID: 1 }),
        reads.ScopeItemIDs({
          kind: "notes",
          libraryID: 1,
          collectionKey: "MISS2345",
        }),
      ]),
    );
    expect(items).toEqual([1, 3, 2]);
    expect(filed).toEqual([1, 2]);
    expect(notes).toEqual([200]);
    expect(unknown).toBeNull();
  });

  it("NoteRefs streams one entry per id, telling a trashed note from a non-note id", async () => {
    const { open } = fixtureOpener(
      () => `
        insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
          values (201, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'TRSH2345');
        insert into itemNotes (itemID, parentItemID, note, title)
          values (201, null, '<p>gone</p>', 'Gone');
        insert into deletedItems (itemID) values (201);
      `,
    );
    const slices = await withReads(
      open,
      (reads) => Stream.runCollect(reads.NoteRefs({ itemIDs: [200, 201, 1] })),
      { sliceSize: 2 },
    );
    expect(slices).toMatchObject([
      [
        {
          itemID: 200,
          note: {
            itemID: 200,
            key: "NTE22345",
            parentItemID: 1,
            title: "Methods",
          },
          trashed: false,
        },
        { itemID: 201, note: null, trashed: true },
      ],
      [{ itemID: 1, note: null, trashed: false }],
    ]);
    expect(slices[0]![0]!.note!.dateModified).toBeInstanceOf(Temporal.Instant);
  });

  it("ChildNoteRefs streams each parent's display ref beside its child notes", async () => {
    const { open } = fixtureOpener();
    const slices = await withReads(
      open,
      (reads) =>
        Stream.runCollect(reads.ChildNoteRefs({ itemIDs: [1, 2, 999] })),
      { sliceSize: 2 },
    );
    expect(slices).toMatchObject([
      [
        {
          itemID: 1,
          ref: { indexedKey: "MAIN2345", title: "Main Study" },
          notes: [{ itemID: 200, key: "NTE22345" }],
        },
        { itemID: 2, ref: { indexedKey: "RELB2345" }, notes: [] },
      ],
      [{ itemID: 999, ref: null, notes: [] }],
    ]);
  });

  /** Ids for one row, and for many: notes live and trashed, items with and without notes, a miss. */
  const sliceIDs = { one: [200], many: [1, 2, 3, 10, 200, 201, 999] };
  it.each<
    [
      string,
      (
        reads: ZoteroReadsClient,
        size: "one" | "many",
      ) => Effect.Effect<unknown, unknown>,
    ]
  >([
    [
      "DisplayRefs",
      (reads, size) =>
        Stream.runDrain(reads.DisplayRefs({ itemIDs: sliceIDs[size] })),
    ],
    [
      "NoteRefs",
      (reads, size) =>
        Stream.runDrain(reads.NoteRefs({ itemIDs: sliceIDs[size] })),
    ],
    [
      "ChildNoteRefs",
      (reads, size) =>
        Stream.runDrain(reads.ChildNoteRefs({ itemIDs: sliceIDs[size] })),
    ],
    // Library 2 indexes one item; library 1 indexes three.
    [
      "IndexItems",
      (reads, size) =>
        Stream.runDrain(
          reads.IndexItems({ libraryID: size === "one" ? 2 : 1 }),
        ),
    ],
    // Live notes, a trashed note, a miss, and a repeat.
    [
      "NoteBodies",
      (reads, size) =>
        reads.NoteBodies({
          libraryID: 1,
          keys:
            size === "one"
              ? ["NTE22345"]
              : ["NTE22345", "NTE32345", "TRSH2345", "MISS2345", "NTE22345"],
        }),
    ],
  ])(
    "%s runs the same statements for one row as for many",
    async (_operation, read) => {
      const { open, statements } = fixtureOpener(
        () => `
          insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
            values (201, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'TRSH2345'),
                   (202, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'NTE32345');
          insert into itemNotes (itemID, parentItemID, note, title)
            values (201, 1, '<p>gone</p>', 'Gone'), (202, 2, '<p>more</p>', 'More');
          insert into deletedItems (itemID) values (201);
        `,
      );
      const counts = await withReads(open, (reads) =>
        Effect.gen(function* () {
          const cost = (size: "one" | "many") =>
            Effect.gen(function* () {
              const before = statements();
              yield* read(reads, size);
              return statements() - before;
            });
          yield* cost("one");
          yield* cost("many");
          // Each read finds rows in one library, so each resolves one group.
          return { one: yield* cost("one"), many: yield* cost("many") };
        }),
      );
      expect(counts.many).toBe(counts.one);
    },
  );

  /** Fifty Indexed Keys of one Library: its live items, misses, and a repeat. */
  const fiftyKeys = (live: string[], suffix: string) => {
    const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
    const misses = Array.from(
      { length: 50 - live.length - 1 },
      (_, i) => `MISS22${alphabet[Math.floor(i / 33)]}${alphabet[i % 33]}`,
    );
    return [...live, ...misses, live[0]!].map((key) => `${key}${suffix}`);
  };
  const userFifty = fiftyKeys(["MAIN2345", "RELA2345", "RELB2345"], "");
  const groupFifty = fiftyKeys(["GRPITEMS"], "g900");

  /** Statements each `ItemsByIndexedKeys` request runs, read warm. */
  const keyReadCosts = (requests: (readonly string[])[]) => {
    const { open, statements } = fixtureOpener();
    return withReads(open, (reads) =>
      Effect.gen(function* () {
        const cost = (indexedKeys: readonly string[]) =>
          Effect.gen(function* () {
            const before = statements();
            yield* reads.ItemsByIndexedKeys({ indexedKeys });
            return statements() - before;
          });
        for (const request of requests) yield* cost(request);
        const costs: number[] = [];
        for (const request of requests) costs.push(yield* cost(request));
        return costs;
      }),
    );
  };

  it.each([
    ["the user Library", ["MAIN2345"], userFifty],
    ["a group Library", ["GRPITEMSg900"], groupFifty],
  ])(
    "ItemsByIndexedKeys runs the same statements for one key of %s as for fifty",
    async (_library, one, fifty) => {
      expect(fifty).toHaveLength(50);
      const [oneCost, fiftyCost] = await keyReadCosts([one, fifty]);
      expect(fiftyCost).toBe(oneCost);
    },
  );

  it("ItemsByIndexedKeys keys spanning two Libraries run each Library's statements once", async () => {
    const [user, group, both] = await keyReadCosts([
      ["MAIN2345"],
      ["GRPITEMSg900"],
      [...userFifty, ...groupFifty],
    ]);
    expect(both).toBe(user! + group!);
    // The user Library needs no resolution: its hydration is the one statement.
    expect(user).toBe(1);
  });

  it("a source that cannot open fails with a tagged DbUnavailable", async () => {
    const { open } = fixtureOpener(() => null);
    const error = await withReads(open, (reads) =>
      Effect.flip(reads.Libraries({})),
    );
    expect(error).toBeInstanceOf(DbUnavailable);
    expect(error).toMatchObject({
      _tag: "DbUnavailable",
      message: "source #1 is not readable",
    });
  });
});

describe("ZoteroReads connection lifetime", () => {
  it("Changes starts with the current state and reports a refresh", async () => {
    const { open, log } = fixtureOpener();
    const events = await withReads(open, (reads) =>
      Effect.gen(function* () {
        yield* reads.Libraries({});
        const changes = yield* Stream.toPull(reads.Changes());
        const seed = yield* take(changes, 1);
        yield* reads.Refresh();
        return [...seed, ...(yield* take(changes, 3))];
      }).pipe(Effect.scoped),
    );
    expect(events).toEqual<ChangeEvent[]>([
      { _tag: "state", state: "ready", error: null },
      { _tag: "refreshing", active: true },
      { _tag: "changed" },
      { _tag: "refreshing", active: false },
    ]);
    expect(log).toEqual(["open #1", "open #2", "close #1", "close #2"]);
  });

  it("a subscriber that joins before the first read sees the connection open", async () => {
    const { open } = fixtureOpener();
    const events = await withReads(open, (reads) =>
      Effect.gen(function* () {
        const changes = yield* Stream.toPull(reads.Changes());
        const seed = yield* take(changes, 1);
        yield* reads.Libraries({});
        return [...seed, ...(yield* take(changes, 1))];
      }).pipe(Effect.scoped),
    );
    expect(events).toEqual<ChangeEvent[]>([
      { _tag: "state", state: "loading", error: null },
      { _tag: "changed" },
    ]);
  });

  it("a subscriber that joins before the first read sees a source that cannot open degrade", async () => {
    const { open } = fixtureOpener(() => null);
    const events = await withReads(open, (reads) =>
      Effect.gen(function* () {
        const changes = yield* Stream.toPull(reads.Changes());
        const seed = yield* take(changes, 1);
        yield* Effect.flip(reads.Libraries({}));
        // A second failed open reports nothing new.
        yield* Effect.flip(reads.Libraries({}));
        return [...seed, ...(yield* take(changes, 1))];
      }).pipe(Effect.scoped),
    );
    expect(events.map((event) => event._tag)).toEqual(["state", "degraded"]);
    expect(events[1]).toHaveProperty(
      "error.message",
      "source #1 is not readable",
    );
  });

  it("a refresh whose new source fails validation keeps the current connection serving", async () => {
    const { open, log } = fixtureOpener((id) =>
      id === 2 ? "drop table libraries;" : "",
    );
    const result = await withReads(open, (reads) =>
      Effect.gen(function* () {
        const before = yield* connectionSeen(reads);
        const changes = yield* Stream.toPull(reads.Changes());
        const seed = yield* take(changes, 1);
        const refresh = yield* Effect.flip(reads.Refresh());
        const after = yield* connectionSeen(reads);
        const rest = yield* take(changes, 3);
        return { before, refresh, after, events: [...seed, ...rest] };
      }).pipe(Effect.scoped),
    );
    expect(result.before).toBe(1);
    expect(result.after).toBe(1);
    expect(result.refresh).toMatchObject({ _tag: "DbUnavailable" });
    expect(result.events.map((event) => event._tag)).toEqual([
      "state",
      "refreshing",
      "refresh-failed",
      "refreshing",
    ]);
    expect(result.events[2]).toMatchObject({
      error: { _tag: "DbUnavailable" },
    });
    expect(result.events[2]!).toHaveProperty(
      "error.message",
      "no such table: libraries",
    );
    expect(log).toEqual(["open #1", "open #2", "close #2", "close #1"]);
  });

  it("a Snapshot keeps its connection across a refresh; the old one closes when the Snapshot ends", async () => {
    const { open, log, closed } = fixtureOpener();
    const seen = await withReads(open, (reads) =>
      Effect.gen(function* () {
        const held = yield* Effect.scoped(
          Effect.gen(function* () {
            const pull = yield* Stream.toPull(reads.Snapshot());
            const [id] = yield* take(pull, 1);
            yield* reads.Refresh();
            const pinned = yield* connectionSeen(reads, id);
            const current = yield* connectionSeen(reads);
            return { pinned, current, log: [...log] };
          }),
        );
        yield* closed(1);
        return held;
      }),
    );
    expect(seen).toEqual({
      pinned: 1,
      current: 2,
      log: ["open #1", "open #2"],
    });
  });

  it("NoteSource reuses one Snapshot's tag, collection, and account lookups across reads", async () => {
    const { open, statements } = fixtureOpener();
    const counts = await withReads(open, (reads) =>
      Effect.gen(function* () {
        const cost = (read: Effect.Effect<unknown, unknown>) =>
          Effect.gen(function* () {
            const before = statements();
            yield* read;
            return statements() - before;
          });
        const unbound = [
          yield* cost(reads.NoteSource({ itemID: 1 })),
          yield* cost(reads.NoteSource({ itemID: 1 })),
        ];
        const pinned = yield* Effect.scoped(
          Effect.gen(function* () {
            const pull = yield* Stream.toPull(reads.Snapshot());
            const [snapshot] = yield* take(pull, 1);
            return [
              yield* cost(reads.NoteSource({ itemID: 1, snapshot })),
              yield* cost(reads.NoteSource({ itemID: 1, snapshot })),
            ];
          }),
        );
        return { unbound, pinned };
      }),
    );
    // The second read of each pair runs warm; only the Snapshot's reuses lookups.
    expect(counts.pinned[1]).toBeLessThan(counts.unbound[1]!);
  });

  it("a Snapshot-bound stream keeps reading its connection after a swap and holds it until the stream ends", async () => {
    // Open #2 drops RELA2345 (item 3); the pinned connection still holds it.
    const { open, log, closed } = fixtureOpener((id) =>
      id === 2 ? "delete from items where itemID = 3;" : "",
    );
    const result = await withReads(
      open,
      (reads) =>
        Effect.gen(function* () {
          const snapshotScope = yield* Scope.make();
          const snapshot = yield* Stream.toPull(reads.Snapshot()).pipe(
            Scope.provide(snapshotScope),
          );
          const [id] = yield* take(snapshot, 1);

          const streamed = yield* Effect.scoped(
            Effect.gen(function* () {
              // Started before the swap. A one-slot buffer keeps the server
              // from reading ahead, so the last slice is read after the swap.
              const slices = yield* Stream.toPull(
                reads.DisplayRefs(
                  { itemIDs: [1, 1, 1, 1, 3], snapshot: id },
                  { streamBufferSize: 1 },
                ),
              );
              const first = yield* take(slices, 1);
              yield* reads.Refresh();
              // Started after the swap, naming the Snapshot.
              const indexed = yield* Stream.runCollect(
                reads.IndexItems({ libraryID: 1, snapshot: id }),
              );

              // End the Snapshot; its id stops answering once the server has
              // ended it, while the stream still holds the connection.
              yield* Scope.close(snapshotScope, Exit.void);
              yield* reads
                .Libraries({ snapshot: id })
                .pipe(Effect.flip, Effect.retry({ times: 100 }));
              const logAfterSnapshotEnd = [...log];

              const rest = yield* take(slices, 4);
              return {
                refs: [...first, ...rest].flat(),
                indexed: indexed.flat().map((item) => item.key),
                logAfterSnapshotEnd,
              };
            }),
          );
          yield* closed(1);
          return streamed;
        }),
      { sliceSize: 1 },
    );
    expect(result.refs.at(-1)).toMatchObject({
      itemID: 3,
      ref: { key: "RELA2345" },
    });
    expect(result.indexed).toEqual(["MAIN2345", "RELA2345", "RELB2345"]);
    expect(result.logAfterSnapshotEnd).toEqual(["open #1", "open #2"]);
  });

  it("a read naming an unknown Snapshot fails with SnapshotExpired", async () => {
    const { open } = fixtureOpener();
    const error = await withReads(open, (reads) =>
      Effect.flip(
        reads.Libraries({ snapshot: SnapshotId.make("snapshot-404") }),
      ),
    );
    expect(error).toBeInstanceOf(SnapshotExpired);
    expect(error).toMatchObject({
      _tag: "SnapshotExpired",
      snapshot: "snapshot-404",
    });
  });

  it("a held Snapshot stays readable however long it is quiet, and ending its stream releases its connection", async () => {
    const { open, closed } = fixtureOpener();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeInProcessClient();
        const snapshotScope = yield* Scope.make();
        const pull = yield* Stream.toPull(reads.Snapshot()).pipe(
          Scope.provide(snapshotScope),
        );
        const [id] = yield* take(pull, 1);
        yield* reads.Refresh();

        yield* TestClock.adjust("1 day");
        const afterADay = yield* connectionSeen(reads, id);

        yield* Scope.close(snapshotScope, Exit.void);
        yield* closed(1);
        const expired = yield* reads
          .Libraries({ snapshot: id })
          .pipe(Effect.flip, Effect.retry({ times: 100 }));
        return { afterADay, expired };
      }).pipe(
        Effect.scoped,
        Effect.provide(layerRcRef(open)),
        Effect.provide(TestClock.layer()),
      ),
    );
    expect(result.afterADay).toBe(1);
    expect(result.expired).toBeInstanceOf(SnapshotExpired);
  });

  it("a request completes while a stream is open", async () => {
    const { open } = fixtureOpener();
    const order = await withReads(
      open,
      (reads) =>
        Effect.gen(function* () {
          const order: string[] = [];
          // A one-slot buffer holds the server mid-stream until the client pulls.
          const slices = yield* Stream.toPull(
            reads.DisplayRefs(
              { itemIDs: Array.from({ length: 10 }, () => 1) },
              { streamBufferSize: 1 },
            ),
          );
          yield* take(slices, 1);
          order.push("first slice");
          yield* reads.Libraries({});
          order.push("libraries");
          yield* take(slices, 9);
          order.push("stream drained");
          return order;
        }).pipe(Effect.scoped),
      { sliceSize: 1 },
    );
    expect(order).toEqual(["first slice", "libraries", "stream drained"]);
  });

  it("interrupting a stream stops its reads and releases its borrow", async () => {
    const { open, closed, statements } = fixtureOpener();
    const result = await withReads(
      open,
      (reads) =>
        Effect.gen(function* () {
          yield* reads.Libraries({});
          const before = statements();
          // Fifty one-item slices behind a one-slot buffer: the server is
          // still mid-stream, waiting on the client, when the take ends it.
          const first = yield* Stream.runCollect(
            Stream.take(
              reads.DisplayRefs(
                { itemIDs: Array.from({ length: 50 }, () => 1) },
                { streamBufferSize: 1 },
              ),
              1,
            ),
          );
          // The swap closes #1 only once the interrupted stream let go of it.
          yield* reads.Refresh();
          yield* closed(1);
          return { first, ran: statements() - before };
        }),
      { sliceSize: 1 },
    );
    expect(result.first).toHaveLength(1);
    // One statement per slice read, plus the refresh's validation: far from
    // the fifty slices an uninterrupted stream would read.
    expect(result.ran).toBeLessThan(10);
  });

  it("a stream read through the service reads no slice ahead of its consumer", async () => {
    const { open, statements } = fixtureOpener();
    await using service = inProcessReadsService(open, {
      handlers: { sliceSize: 1 },
    });
    const { reads } = await service.ready;
    const { oneSlice, held } = await Effect.runPromise(
      Effect.gen(function* () {
        const cost = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
          Effect.gen(function* () {
            const before = statements();
            yield* effect;
            return statements() - before;
          });
        const items = Array.from({ length: 50 }, () => 1);
        yield* Stream.runDrain(reads.DisplayRefs({ itemIDs: [1] }));
        const oneSlice = yield* cost(
          Stream.runDrain(reads.DisplayRefs({ itemIDs: [1] })),
        );
        // The consumer holds the first slice while other requests complete;
        // each round trip gives a server that reads ahead the chance to.
        const roundTrips = Effect.gen(function* () {
          for (let i = 0; i < 20; i++) yield* reads.Libraries({});
        });
        const alone = yield* cost(roundTrips);
        const held = yield* cost(
          Effect.gen(function* () {
            const slices = yield* Stream.toPull(
              reads.DisplayRefs({ itemIDs: items }),
            );
            yield* take(slices, 1);
            yield* roundTrips;
          }),
        );
        return { oneSlice, held: held - alone };
      }).pipe(Effect.scoped),
    );
    // The pulled slice, and at most the one the server read before it
    // waits for the next pull.
    expect(held).toBeLessThanOrEqual(2 * oneSlice);
  });

  it("Configure hands the new settings to the opener and swaps the connection", async () => {
    const { open, configs } = fixtureOpener();
    const config: ReadsConfig = {
      databasePath: "/Zotero/zotero.sqlite",
      readMode: "immutable",
      autoRefresh: true,
      locale: null,
    };
    const seen = await withReads(open, (reads) =>
      Effect.gen(function* () {
        yield* reads.Libraries({});
        yield* reads.Configure(config);
        return yield* connectionSeen(reads);
      }),
    );
    expect(configs).toEqual([null, config]);
    expect(seen).toBe(2);
  });

  it("NotifyExternalChange refreshes the connection", async () => {
    const { open } = fixtureOpener();
    const seen = await withReads(open, (reads) =>
      Effect.gen(function* () {
        yield* reads.Libraries({});
        yield* reads.NotifyExternalChange();
        return yield* connectionSeen(reads);
      }),
    );
    expect(seen).toBe(2);
  });
});

describe("ZoteroReads citation operations", () => {
  it("AttachmentsAt returns an attachment itself, a regular item's attachments, or nothing", async () => {
    const { open } = fixtureOpener();
    const [own, children, none] = await withReads(open, (reads) =>
      Effect.all([
        reads.AttachmentsAt({ itemID: 10 }),
        reads.AttachmentsAt({ itemID: 1 }),
        reads.AttachmentsAt({ itemID: 999 }),
      ]),
    );
    expect(own).toMatchObject([{ itemID: 10, key: "ATCH2345" }]);
    expect(children).toMatchObject([{ itemID: 10, key: "ATCH2345" }]);
    expect(none).toEqual([]);
  });

  it("ItemsByIndexedKeys answers in the order of the requested keys", async () => {
    const { open } = fixtureOpener();
    const items = await withReads(open, (reads) =>
      reads.ItemsByIndexedKeys({
        indexedKeys: ["RELB2345", "GRPITEMSg900", "MISS2345", "MAIN2345"],
      }),
    );
    expect([...items.keys()]).toEqual(["RELB2345", "GRPITEMSg900", "MAIN2345"]);
  });

  it("ItemsByIndexedKeys answers each key under the spelling it was asked by", async () => {
    const { open } = fixtureOpener();
    const items = await withReads(open, (reads) =>
      reads.ItemsByIndexedKeys({
        indexedKeys: ["GRPITEMSg0900", "GRPITEMSg900"],
      }),
    );
    expect([...items.keys()]).toEqual(["GRPITEMSg0900", "GRPITEMSg900"]);
    expect(items.get("GRPITEMSg0900")).toMatchObject({
      key: "GRPITEMS",
      indexedKey: "GRPITEMSg900",
    });
  });
});

describe("ZoteroReads annotation-family operations", () => {
  it("AttachmentSources returns attachments by Indexed Key with their parent items, tags, and username", async () => {
    const { open } = fixtureOpener();
    const sources = await withReads(open, (reads) =>
      reads.AttachmentSources({ attachmentKeys: ["ATCH2345", "MISS2345"] }),
    );
    expect(sources.annotations).toEqual([]);
    expect(sources.attachments.map((a) => a.indexedKey)).toEqual(["ATCH2345"]);
    expect(sources.attachments[0]!.dateAdded).toBeInstanceOf(Temporal.Instant);
    expect(sources.parentItems.map((i) => i.key)).toEqual(["MAIN2345"]);
    expect(sources.tagsByItemID.get(1)!.map((tag) => tag.tag.name)).toEqual([
      "zt",
    ]);
    expect(sources.username).toBe("reader");
  });
});

describe("ZoteroReads Profile Match operations", () => {
  it("TagNames lists the tag names of one library, or of every library", async () => {
    const { open } = fixtureOpener(
      () => `insert into tags (tagID, name) values (4, 'Alpha');
        insert into itemTags (itemID, tagID, type) values (300, 4, 0);`,
    );
    const names = await withReads(open, (reads) =>
      Effect.all({
        user: reads.TagNames({ libraryID: 1 }),
        group: reads.TagNames({ libraryID: 2 }),
        all: reads.TagNames({}),
      }),
    );
    expect(names).toEqual({
      user: ["claim", "method", "zt"],
      group: ["Alpha"],
      all: ["Alpha", "claim", "method", "zt"],
    });
  });

  it("CollectionPaths lists every live collection path of the given libraries, root first", async () => {
    const { open } = fixtureOpener(
      () => `insert into collections (collectionID, collectionName, libraryID, key, parentCollectionID)
        values (501, 'Theory', 1, 'CLL32345', 500), (502, 'Lab Notes', 2, 'CLL42345', null);`,
    );
    const paths = await withReads(open, (reads) =>
      Effect.all({
        user: reads.CollectionPaths({ libraryIDs: [1] }),
        both: reads.CollectionPaths({ libraryIDs: [1, 2] }),
      }),
    );
    expect(paths).toEqual({
      user: [["Reading"], ["Reading", "Theory"]],
      both: [["Lab Notes"], ["Reading"], ["Reading", "Theory"]],
    });
  });

  it("MembershipFacts names an item's tags and direct collection paths", async () => {
    const { open } = fixtureOpener();
    const facts = await withReads(open, (reads) =>
      Effect.all({
        main: reads.MembershipFacts({ itemID: 1, libraryID: 1 }),
        group: reads.MembershipFacts({ itemID: 300, libraryID: 2 }),
      }),
    );
    expect(facts).toEqual({
      main: { tags: ["zt"], collections: [["Reading"]] },
      group: { tags: [], collections: [] },
    });
  });
});

describe("ZoteroReads SearchItems", () => {
  /** `effect`'s value and the statements it ran on every connection. */
  const costOf =
    (statements: () => number) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const before = statements();
        const value = yield* effect;
        return { value, cost: statements() - before };
      });

  const everything = { libraryIDs: [1, 2], query: "", limit: 10 };
  const inLibrary = (libraryID: number, query = "") => ({
    libraryIDs: [libraryID],
    query,
    limit: 10,
  });
  const keysOf = (hits: readonly { item: { indexedKey: string } }[]) =>
    hits.map((hit) => hit.item.indexedKey);

  /** The SQL `query` runs, read from a scratch fixture database. */
  function sqlOf(query: (client: NodeDatabaseClient) => unknown): string {
    const client = createClient(":memory:");
    const sqlite = client.$client;
    createFixtureSchema(sqlite);
    const prepare = sqlite.prepare.bind(sqlite);
    let seen = "";
    sqlite.prepare = (source: string) => {
      seen = source;
      return prepare(source);
    };
    query(client);
    sqlite.close();
    return seen;
  }
  /** A build reads each Library's ids once; nothing else runs this. */
  const ID_READ = sqlOf((client) => getIndexedItemIDsByLibrary(client, 1));
  const SIGNATURE_READ = sqlOf((client) => getIndexSignature(client, 1));

  /**
   * Run `effect` until `accept` holds for its value, at most 500 times a
   * millisecond apart; answers the last value either way.
   */
  const eventually = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    accept: (value: A) => boolean,
  ) =>
    Effect.gen(function* () {
      let value = yield* effect;
      for (let tries = 0; tries < 500 && !accept(value); tries++) {
        yield* Effect.sleep("1 millis");
        value = yield* effect;
      }
      return value;
    });

  /** SQL for `count` more journal articles in My Library, older than SEED's. */
  const bulkWorks = (count: number) =>
    Array.from(
      { length: count },
      (_, i) =>
        `insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key) values (${1000 + i}, 1, '2023-01-01 00:00:00', '2023-01-01 00:00:00', 1, 'BULK${String(i).padStart(4, "0")}');`,
    ).join("\n");

  /**
   * {@link layerRcRef} over `opener`, with `degrade`: later borrows fail and
   * the feed reports `degraded`, as when no client can serve.
   */
  const degradableConnection = (opener: ConnectionOpener) => {
    let failure: DbUnavailable | null = null;
    let publish: (event: ChangeEvent) => Effect.Effect<void> = () =>
      Effect.void;
    const layer = Layer.effect(Connection)(
      Effect.gen(function* () {
        const base = yield* Connection;
        const extra = yield* PubSub.unbounded<ChangeEvent>();
        publish = (event) => PubSub.publish(extra, event).pipe(Effect.asVoid);
        return Connection.of({
          ...base,
          borrow: Effect.suspend(() =>
            failure ? Effect.fail(failure) : base.borrow,
          ),
          changes: Stream.merge(base.changes, Stream.fromPubSub(extra)),
        });
      }),
    ).pipe(Layer.provide(layerRcRef(opener)));
    const degrade = Effect.suspend(() => {
      failure = new DbUnavailable({ message: "database gone" });
      return publish({ _tag: "degraded", error: failure });
    });
    return { layer, degrade };
  };

  /** Run `body` against an in-process client over the `connection` layer. */
  const withConnection = <A, E>(
    connection: Layer.Layer<Connection>,
    body: (reads: ZoteroReadsClient) => Effect.Effect<A, E, Scope.Scope>,
  ): Promise<A> =>
    Effect.runPromise(
      Effect.gen(function* () {
        const reads = yield* makeInProcessClient();
        return yield* body(reads);
      }).pipe(Effect.scoped, Effect.provide(connection)),
    );

  it("the first search builds the index and answers hydrated Items; later searches reuse it", async () => {
    const { open, statements } = fixtureOpener();
    const cost = costOf(statements);
    const result = await withReads(open, (reads) =>
      Effect.gen(function* () {
        const first = yield* cost(reads.SearchItems(everything));
        const second = yield* cost(reads.SearchItems(everything));
        const third = yield* cost(reads.SearchItems(everything));
        return { first, second, third };
      }),
    );
    expect(result.first.value.map((hit) => hit.item.indexedKey)).toEqual([
      "MAIN2345",
      "GRPITEMSg900",
      "RELA2345",
      "RELB2345",
    ]);
    expect(result.first.value[0]!.item.dateAdded).toBeInstanceOf(
      Temporal.Instant,
    );
    expect(result.second.value).toEqual(result.first.value);
    // The build reads ids and rows; a later search only hydrates.
    expect(result.first.cost).toBeGreaterThan(result.second.cost);
    expect(result.third.cost).toBe(result.second.cost);
  });

  it("a fresh adapter builds nothing before the first search", async () => {
    const { open, ran, closed } = fixtureOpener();
    const result = await withReads(open, (reads) =>
      Effect.gen(function* () {
        // The first open and a refresh each publish `changed`.
        yield* reads.Libraries({});
        yield* reads.Refresh();
        yield* closed(1);
        const before = ran(ID_READ);
        yield* reads.SearchItems(everything);
        return { before, after: ran(ID_READ) };
      }),
    );
    expect(result).toEqual({ before: 0, after: 2 });
  });

  it("two parallel first searches share one build", async () => {
    const { open, ran } = fixtureOpener();
    const [a, b] = await withReads(open, (reads) =>
      Effect.all(
        [reads.SearchItems(everything), reads.SearchItems(everything)],
        { concurrency: "unbounded" },
      ),
    );
    expect(keysOf(b)).toEqual(keysOf(a));
    expect(a).toHaveLength(4);
    // One ids read per Library of one build.
    expect(ran(ID_READ)).toBe(2);
  });

  it("ranks a Zotero key and a citation key prefix first", async () => {
    const { open } = fixtureOpener();
    const result = await withReads(open, (reads) =>
      Effect.all({
        key: reads.SearchItems({ ...everything, query: "GRPITEMS" }),
        citationKey: reads.SearchItems({ ...everything, query: "main20" }),
        title: reads.SearchItems({ ...everything, query: "alpha" }),
      }),
    );
    expect(keysOf(result.key)).toEqual(["GRPITEMSg900"]);
    expect(keysOf(result.citationKey)[0]).toBe("MAIN2345");
    expect(keysOf(result.title)).toEqual(["RELA2345"]);
    expect(result.title[0]!.matches).toEqual([[0, 5]]);
  });

  it("answers only the Libraries asked for, best first, up to the limit", async () => {
    const { open } = fixtureOpener();
    const result = await withReads(open, (reads) =>
      Effect.all({
        user: reads.SearchItems(inLibrary(1)),
        group: reads.SearchItems(inLibrary(2)),
        two: reads.SearchItems({ ...everything, limit: 2 }),
      }),
    );
    expect(keysOf(result.user)).toEqual(["MAIN2345", "RELA2345", "RELB2345"]);
    expect(keysOf(result.group)).toEqual(["GRPITEMSg900"]);
    expect(keysOf(result.two)).toEqual(["MAIN2345", "GRPITEMSg900"]);
  });

  it("a refresh that moves a signature rebuilds, and the answer changes", async () => {
    const { open } = fixtureOpener((id) =>
      id === 1
        ? ""
        : `insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
             values (4, 1, '2024-03-01 00:00:00', '2024-03-01 00:00:00', 1, 'NEWW2345');
           insert into itemDataValues (valueID, value) values (50, 'Fresh Find');
           insert into itemData (itemID, fieldID, valueID) values (4, 10, 50);`,
    );
    const result = await withReads(open, (reads) =>
      Effect.gen(function* () {
        const before = yield* reads.SearchItems(inLibrary(1, "fresh"));
        yield* reads.Refresh();
        const after = yield* eventually(
          reads.SearchItems(inLibrary(1, "fresh")),
          (hits) => hits.length > 0,
        );
        return { before, after };
      }),
    );
    expect(result.before).toEqual([]);
    expect(keysOf(result.after)).toEqual(["NEWW2345"]);
  });

  it("a refresh of the same database with equal signatures keeps the index", async () => {
    // The rename leaves `dateModified`, so the signatures stay equal.
    const { open, ran, closed } = fixtureOpener((id) =>
      id === 1
        ? ""
        : "update itemDataValues set value = 'Quagga Study' where valueID = 1;",
    );
    const result = await withReads(open, (reads) =>
      Effect.gen(function* () {
        yield* reads.SearchItems(everything);
        // The `changed` of #2 re-checks the index on #2; the swap to #3
        // closes #2 once that re-check let go of it. The search between
        // keeps the list from eviction at the second change.
        yield* reads.Refresh();
        yield* reads.SearchItems(everything);
        yield* reads.Refresh();
        yield* closed(2);
        return {
          signatures: ran(SIGNATURE_READ, 2),
          builds: ran(ID_READ, 2),
          renamed: yield* reads.SearchItems({ ...everything, query: "quagga" }),
        };
      }),
    );
    expect(result.signatures).toBeGreaterThan(0);
    expect(result.builds).toBe(0);
    expect(result.renamed).toEqual([]);
  });

  it("a refresh to another database file whose Libraries have equal local ids rebuilds", async () => {
    // Same ids and signatures; another local user key marks another database.
    const { open } = fixtureOpener((id) =>
      id === 1
        ? ""
        : `insert into settings (setting, key, value) values ('account', 'localUserKey', 'OTHERDB${id}');
           update itemDataValues set value = 'Quagga Study' where valueID = 1;`,
    );
    const renamed = await withReads(open, (reads) =>
      Effect.gen(function* () {
        yield* reads.SearchItems(everything);
        yield* reads.Refresh();
        return yield* eventually(
          reads.SearchItems({ ...everything, query: "quagga" }),
          (hits) => hits.length > 0,
        );
      }),
    );
    expect(keysOf(renamed)).toEqual(["MAIN2345"]);
    expect(renamed[0]!.item.fields).toMatchObject({ title: "Quagga Study" });
  });

  it("a Library list no search asked for since the last change is evicted at the next", async () => {
    const { open, ran } = fixtureOpener();
    const result = await withReads(open, (reads) =>
      Effect.gen(function* () {
        yield* reads.SearchItems(inLibrary(1));
        yield* reads.SearchItems(inLibrary(2));
        yield* reads.Refresh();
        // Only the group list is asked for before the next change.
        yield* reads.SearchItems(inLibrary(2));
        yield* reads.Refresh();
        const before = ran(ID_READ);
        const user = yield* reads.SearchItems(inLibrary(1));
        const group = yield* reads.SearchItems(inLibrary(2));
        return { user, group, builds: ran(ID_READ) - before };
      }),
    );
    expect(keysOf(result.user)).toEqual(["MAIN2345", "RELA2345", "RELB2345"]);
    expect(keysOf(result.group)).toEqual(["GRPITEMSg900"]);
    // The user list builds anew; the group list answers from its index.
    expect(result.builds).toBe(1);
  });

  it("a hit whose Item vanished since the build is left out", async () => {
    const client = createClient(":memory:");
    createFixtureSchema(client.$client);
    client.$client.exec(SEED);
    const answers = await withConnection(
      layerRcRef(sharedClientOpener(client)),
      (reads) =>
        Effect.gen(function* () {
          const before = yield* reads.SearchItems(inLibrary(1));
          // No change event: the index still holds the Item.
          client.$client.exec(
            "delete from itemData where itemID = 3; delete from items where itemID = 3;",
          );
          const after = yield* reads.SearchItems(inLibrary(1));
          return { before, after };
        }),
    );
    client.$client.close();
    expect(keysOf(answers.before)).toEqual([
      "MAIN2345",
      "RELA2345",
      "RELB2345",
    ]);
    expect(keysOf(answers.after)).toEqual(["MAIN2345", "RELB2345"]);
  });

  it("a degraded connection fails the search with DbUnavailable", async () => {
    const { open } = fixtureOpener();
    const { layer, degrade } = degradableConnection(open);
    const result = await withConnection(layer, (reads) =>
      Effect.gen(function* () {
        const before = yield* reads.SearchItems(everything);
        yield* degrade;
        const error = yield* Effect.flip(reads.SearchItems(everything));
        return { before, error };
      }),
    );
    expect(result.before).toHaveLength(4);
    expect(result.error).toBeInstanceOf(DbUnavailable);
    expect(result.error.message).toBe("database gone");
  });

  it("a source that cannot open fails the search with DbUnavailable", async () => {
    const { open } = fixtureOpener(() => null);
    const error = await withReads(open, (reads) =>
      Effect.flip(reads.SearchItems(everything)),
    );
    expect(error).toBeInstanceOf(DbUnavailable);
  });

  it("an interrupted first search leaves its build running for the next search", async () => {
    const { open, ran } = fixtureOpener(() => bulkWorks(3000));
    const result = await withReads(open, (reads) =>
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(
          reads.SearchItems(inLibrary(1, "main")),
        );
        yield* eventually(
          Effect.sync(() => ran(ID_READ)),
          (count) => count > 0,
        );
        yield* Fiber.interrupt(first);
        const next = yield* reads.SearchItems(inLibrary(1, "main"));
        return { next, builds: ran(ID_READ) };
      }),
    );
    expect(keysOf(result.next)).toEqual(["MAIN2345"]);
    expect(result.builds).toBe(1);
  });

  it("a locale change through Configure rebuilds the held index", async () => {
    const { open, ran } = fixtureOpener();
    // A source that rebinds without a new client, as for a locale-only change.
    const quiet = Layer.effect(Connection)(
      Effect.map(Effect.service(Connection), (base) =>
        Connection.of({ ...base, configure: () => Effect.void }),
      ),
    ).pipe(Layer.provide(layerRcRef(open)));
    const config = (locale: string | null): ReadsConfig => ({
      databasePath: "/Zotero/zotero.sqlite",
      readMode: "auto",
      autoRefresh: true,
      locale,
    });
    const builds = await withConnection(quiet, (reads) =>
      Effect.gen(function* () {
        yield* reads.SearchItems(everything);
        yield* reads.Configure(config("de"));
        return yield* eventually(
          Effect.sync(() => ran(ID_READ)),
          (count) => count >= 4,
        );
      }),
    );
    // Two ids reads per build: the first build and the rebuild.
    expect(builds).toBe(4);
  });

  it("a request sent during a build is answered before the build ends", async () => {
    const { open, ran } = fixtureOpener(() => bulkWorks(3000));
    const order = await withReads(open, (reads) =>
      Effect.gen(function* () {
        const order: string[] = [];
        const search = yield* Effect.forkChild(
          reads
            .SearchItems(inLibrary(1, "main"))
            .pipe(Effect.tap(() => Effect.sync(() => order.push("search")))),
        );
        yield* eventually(
          Effect.sync(() => ran(ID_READ)),
          (count) => count > 0,
        );
        yield* reads.Ping();
        order.push("ping");
        yield* Fiber.join(search);
        return order;
      }),
    );
    expect(order).toEqual(["ping", "search"]);
  });
});
