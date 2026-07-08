import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type NodeDatabaseClient } from "@/client/node";
import { USER_LIBRARY_ID } from "@/lib/constants";
import { type TemplateItemResolvers } from "@/lib/context/zt-template-item";
import { type Annotation } from "@/lib/zt-annot";
import { CollectionCache } from "@/lib/zt-collection";
import { getAnnotationsByParent } from "@/queries/annotations";
import { getItemsByKey } from "@/queries/items";
import { resolveItemTagsByIDs, type TagMemo } from "@/queries/tags";
import { createFixtureSchema } from "@/test-utils";

import {
  fetchAnnotationsTemplateData,
  fetchNoteContext,
  type AnnotationResolvers,
  type NoteResolvers,
} from "./note-context";

let sqlite: DatabaseSync;
let db: NodeDatabaseClient;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  seed(sqlite);
  db = drizzle({ client: sqlite, relations });
});

afterEach(() => {
  sqlite.close();
});

const itemResolvers: TemplateItemResolvers = {
  notePath: (item) => `notes/${item.indexedKey}.md`,
  noteLink: (item, alias) => `[[notes/${item.indexedKey}|${alias ?? ""}]]`,
  authorsShort: (item) => `short:${item.key}`,
};

const annotationResolvers: AnnotationResolvers = {
  filePath: (attachment) => `/abs/${attachment.key}`,
  fileLink: (attachment, page) => (alias) =>
    page == null
      ? `[[${attachment.key}|${alias ?? attachment.key}]]`
      : `[[${attachment.key}#page=${page}|${alias ?? attachment.key}]]`,
  annotationImageLink: () => null,
  commentToMarkdown: (html) => `md(${html})`,
};

const noteResolvers: NoteResolvers = {
  item: itemResolvers,
  annotation: annotationResolvers,
  resolveChildNote: (note) => ({
    key: note.key,
    title: note.title,
    noteLink: (alias) => `[[${note.key}|${alias ?? note.title}]]`,
  }),
};

describe("fetchNoteContext", () => {
  it("fetches attachments, annotations, related items, and child notes into the assembled context", () => {
    const [main] = getItemsByKey(db, USER_LIBRARY_ID, ["MAIN0001"]);

    const ctx = fetchNoteContext(db, main!, {
      resolvers: noteResolvers,
      collectionCache: new CollectionCache(),
    });

    expect(ctx.tags.map((t) => t.tag.name)).toEqual(["zt"]);
    expect(ctx.collections.map((c) => c.name)).toEqual(["Reading"]);

    expect(ctx.attachments).toHaveLength(1);
    expect(ctx.attachments[0]!.key).toBe("ATCH0001");

    expect(ctx.annotations.map((a) => a.key)).toEqual(["ANNO0001", "ANNO0002"]);
    expect(ctx.annotations[0]!.tags.map((t) => t.tag.name)).toEqual(["claim"]);
    expect(ctx.annotations[0]!.comment).toBe("md(<i>excerpt</i>)");
    expect(ctx.annotations[0]!.parentAttachment).toBe(ctx.attachments[0]);

    expect(ctx.relatedItems.map((r) => r.title)).toEqual([
      "Alpha Paper",
      "Beta Book",
    ]);
    const beta = ctx.relatedItems.find((r) => r.title === "Beta Book")!;
    expect(beta.tags.map((t) => t.tag.name)).toEqual(["method"]);
    expect(beta.collections.map((c) => c.name)).toEqual(["Reading"]);
    expect(beta.authorsShort).toBe("short:RELB0001");

    expect(ctx.notes).toHaveLength(1);
    expect(ctx.notes[0]!.key).toBe("NOTE0001");
    expect(ctx.notes[0]!.title).toBe("Methods");
  });

  it("reuses a caller-supplied TagMemo/CollectionCache instead of re-querying", () => {
    const [main] = getItemsByKey(db, USER_LIBRARY_ID, ["MAIN0001"]);

    const tagMemo: TagMemo = new Map();
    const collectionCache = new CollectionCache();
    // Pre-populate both caches for the main item, as an earlier filename-
    // resolution call would (see note-feature's resolveNotePath).
    resolveItemTagsByIDs(db, [main!.itemID], tagMemo);
    collectionCache.byItemIDs(db, USER_LIBRARY_ID, [main!.itemID]);

    // Mutate the underlying rows directly: if fetchNoteContext re-queried
    // instead of reusing the cache, the result would reflect this change.
    sqlite.exec("delete from itemTags where itemID = 1");
    sqlite.exec("delete from collectionItems where itemID = 1");

    const ctx = fetchNoteContext(db, main!, {
      resolvers: noteResolvers,
      tagMemo,
      collectionCache,
    });

    expect(ctx.tags.map((t) => t.tag.name)).toEqual(["zt"]);
    expect(ctx.collections.map((c) => c.name)).toEqual(["Reading"]);
  });
});

describe("fetchAnnotationsTemplateData", () => {
  it("batches annotations sharing a parent attachment onto one template bundle", () => {
    const annotations = getAnnotationsByParent(db, 10);

    const result = fetchAnnotationsTemplateData(db, annotations, {
      resolvers: annotationResolvers,
    });

    expect([...result.keys()]).toEqual(["ANNO0001", "ANNO0002"]);
    const [first, second] = [...result.values()];
    expect(first!.parentAttachment).toBe(second!.parentAttachment);
    expect(first!.parentItem).toBe(second!.parentItem);
    expect(first!.tags.map((t) => t.tag.name)).toEqual(["claim"]);
    expect(second!.tags).toEqual([]);
  });

  it("stubs parentItem.notePath/noteLink as unresolved instead of throwing", () => {
    const annotations = getAnnotationsByParent(db, 10);

    const result = fetchAnnotationsTemplateData(db, annotations, {
      resolvers: annotationResolvers,
    });

    const [first] = [...result.values()];
    const parentItem = first!.parentItem;
    expect(parentItem).not.toBeNull();
    expect(parentItem!.notePath).toBeNull();
    expect(parentItem!.noteLink()).toBeNull();
  });

  it("omits an annotation whose parent attachment can't be resolved", () => {
    const [resolvable] = getAnnotationsByParent(db, 10);
    const orphan: Annotation = {
      ...resolvable!,
      key: "ORPHAN01",
      itemID: 999,
      parentItemID: 9999,
    };

    const result = fetchAnnotationsTemplateData(db, [resolvable!, orphan], {
      resolvers: annotationResolvers,
    });

    expect([...result.keys()]).toEqual(["ANNO0001"]);
  });

  it("returns an empty map for empty input", () => {
    expect(
      fetchAnnotationsTemplateData(db, [], { resolvers: annotationResolvers }),
    ).toEqual(new Map());
  });

  it("keeps an annotation on a standalone attachment with parentItem: null, and still builds its backlink", () => {
    const [nonStandalone] = getAnnotationsByParent(db, 10);
    const [standalone] = getAnnotationsByParent(db, 20);

    const result = fetchAnnotationsTemplateData(
      db,
      [nonStandalone!, standalone!],
      { resolvers: annotationResolvers },
    );

    expect([...result.keys()]).toEqual(["ANNO0001", "ANNO0003"]);

    expect(result.get("ANNO0001")!.parentItem).not.toBeNull();

    const standaloneTpl = result.get("ANNO0003")!;
    expect(standaloneTpl.parentItem).toBeNull();
    expect(standaloneTpl.parentAttachment.key).toBe("ATCH0002");
    expect(() => standaloneTpl.backlink).not.toThrow();
    expect(standaloneTpl.backlink).toContain("ANNO0003");
  });
});

function seed(sqlite: DatabaseSync): void {
  createFixtureSchema(sqlite);
  sqlite.exec(`
    insert into libraries (libraryID, type, editable, filesEditable)
      values (1, 'user', 1, 1);

    insert into itemTypes (itemTypeID, typeName)
      values
        (1, 'journalArticle'),
        (2, 'attachment'),
        (3, 'note'),
        (4, 'annotation'),
        (5, 'book');

    insert into fieldsCombined (fieldID, fieldName, custom)
      values (10, 'title', 0), (11, 'citationKey', 0);

    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (1, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'MAIN0001'),
        (2, 5, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'RELB0001'),
        (3, 1, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'RELA0001'),
        (10, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATCH0001'),
        (20, 2, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ATCH0002'),
        (100, 4, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNO0001'),
        (101, 4, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNO0002'),
        (102, 4, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'ANNO0003'),
        (200, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 1, 'NOTE0001');

    insert into itemDataValues (valueID, value)
      values (1, 'Main Study'), (2, 'Beta Book'), (3, 'Alpha Paper');

    insert into itemData (itemID, fieldID, valueID)
      values (1, 10, 1), (2, 10, 2), (3, 10, 3);

    insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
      values
        (10, 1, 0, 'application/pdf', 'storage:paper.pdf'),
        (20, null, 0, 'application/pdf', 'storage:standalone.pdf');

    insert into itemAnnotations (
      itemID, parentItemID, type, authorName, text, comment, color, pageLabel,
      sortIndex, position, isExternal
    )
      values
        (100, 10, 1, null, 'excerpt', '<i>excerpt</i>', '#ffd400', '1',
         '00000|000000|00000', '{"pageIndex":0,"rects":[[0,0,1,1]]}', 0),
        (101, 10, 3, null, null, null, '#ffd400', '1',
         '00000|000001|00000', '{"pageIndex":0,"rects":[[0,0,1,1]]}', 0),
        (102, 20, 1, null, 'standalone excerpt', null, '#ffd400', '1',
         '00000|000000|00000', '{"pageIndex":0,"rects":[[0,0,1,1]]}', 0);

    insert into itemNotes (itemID, parentItemID, note, title)
      values (200, 1, '<p>body</p>', 'Methods');

    insert into tags (tagID, name)
      values (1, 'zt'), (2, 'method'), (3, 'claim');

    insert into itemTags (itemID, tagID, type)
      values (1, 1, 0), (2, 2, 0), (100, 3, 0);

    insert into relationPredicates (predicateID, predicate)
      values (1, 'dc:relation');

    insert into itemRelations (itemID, predicateID, object)
      values
        (1, 1, 'http://zotero.org/users/local/BOtEiq6p/items/RELB0001'),
        (1, 1, 'http://zotero.org/users/local/BOtEiq6p/items/RELA0001');

    insert into collections (collectionID, collectionName, libraryID, key)
      values (500, 'Reading', 1, 'COLL0500');

    insert into collectionItems (collectionID, itemID)
      values (500, 1), (500, 2);
  `);
}
