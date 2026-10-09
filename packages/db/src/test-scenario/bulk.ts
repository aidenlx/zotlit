// A Library large enough to need several statements on every plan path: the
// responsiveness invariants of Item Query run on it. It is separate from the
// scenario Items, whose tests pin exact rows.
import type { DatabaseSync } from "node:sqlite";

import { lookupID } from "./seed";

/** The Library that {@link seedBulkLibrary} fills. */
export const BULK_LIBRARY = {
  libraryID: 3,
  groupID: 2718,
  name: "Bulk Library",
} as const;

/** The Tag on every bulk Item. */
export const BULK_TAG = "bulk";
/** The Tag on every fifth bulk Item, the first one included. */
export const BULK_FIFTH_TAG = "bulk-fifth";

const KEY_ALPHABET = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";

/** The Zotero Key of the bulk Item at `index`; key order is index order. */
export function bulkItemKey(index: number): string {
  let rest = index;
  let text = "";
  for (let i = 0; i < 5; i++) {
    text = KEY_ALPHABET[rest % KEY_ALPHABET.length]! + text;
    rest = Math.floor(rest / KEY_ALPHABET.length);
  }
  return `BLK${text}`;
}

/**
 * Add the bulk Library to a scenario database: `count` top-level journal
 * articles, each with a title (`Bulk item 00000`, by index), a modification
 * time one second after the Item before it, and {@link BULK_TAG}. Every fifth
 * Item also carries {@link BULK_FIFTH_TAG}.
 */
export function seedBulkLibrary(sqlite: DatabaseSync, count: number): void {
  const itemTypeID = lookupID(
    sqlite,
    "select itemTypeID as id from itemTypesCombined where typeName = ?",
    "journalArticle",
  );
  const titleID = lookupID(
    sqlite,
    "select fieldID as id from fieldsCombined where fieldName = ? and custom = 0",
    "title",
  );
  const insertTag = sqlite.prepare("insert into tags (name) values (?)");
  const insertItem = sqlite.prepare(
    "insert into items (itemTypeID, dateAdded, dateModified, clientDateModified, libraryID, key) values (?, ?, ?, ?, ?, ?)",
  );
  const insertGroupItem = sqlite.prepare(
    "insert into groupItems (itemID, createdByUserID, lastModifiedByUserID) values (?, null, null)",
  );
  const insertValue = sqlite.prepare(
    "insert into itemDataValues (value) values (?)",
  );
  const insertData = sqlite.prepare(
    "insert into itemData (itemID, fieldID, valueID) values (?, ?, ?)",
  );
  const insertItemTag = sqlite.prepare(
    "insert into itemTags (itemID, tagID, type) values (?, ?, 0)",
  );

  sqlite.exec("begin");
  try {
    const { libraryID, groupID, name } = BULK_LIBRARY;
    sqlite
      .prepare(
        "insert into libraries (libraryID, type, editable, filesEditable) values (?, 'group', 1, 1)",
      )
      .run(libraryID);
    sqlite
      .prepare(
        "insert into groups (groupID, libraryID, name, description, version) values (?, ?, ?, '', 0)",
      )
      .run(groupID, libraryID, name);
    const everyTagID = Number(insertTag.run(BULK_TAG).lastInsertRowid);
    const fifthTagID = Number(insertTag.run(BULK_FIFTH_TAG).lastInsertRowid);

    const start = Temporal.Instant.from("2021-01-01T00:00:00Z");
    for (let index = 0; index < count; index++) {
      const stamp = start
        .add({ seconds: index })
        .toString()
        .slice(0, 19)
        .replace("T", " ");
      const itemID = Number(
        insertItem.run(
          itemTypeID,
          stamp,
          stamp,
          stamp,
          libraryID,
          bulkItemKey(index),
        ).lastInsertRowid,
      );
      insertGroupItem.run(itemID);
      const title = `Bulk item ${String(index).padStart(5, "0")}`;
      insertData.run(
        itemID,
        titleID,
        Number(insertValue.run(title).lastInsertRowid),
      );
      insertItemTag.run(itemID, everyTagID);
      if (index % 5 === 0) insertItemTag.run(itemID, fifthTagID);
    }
    sqlite.exec("commit");
  } catch (error) {
    sqlite.exec("rollback");
    throw error;
  }
}

/** Add `count` Annotations on one PDF in the seeded bulk Library. Every fifth is an image. */
export function seedBulkAnnotations(sqlite: DatabaseSync, count: number): void {
  const typeID = (name: string) =>
    lookupID(
      sqlite,
      "select itemTypeID as id from itemTypesCombined where typeName = ?",
      name,
    );
  const parentID = lookupID(
    sqlite,
    "select itemID as id from items where key = ?",
    bulkItemKey(0),
  );
  const insertItem = sqlite.prepare(
    "insert into items (itemTypeID, libraryID, key) values (?, ?, ?)",
  );
  const annotationTypeID = typeID("annotation");
  sqlite.exec("begin");
  try {
    const attachmentID = Number(
      insertItem.run(typeID("attachment"), BULK_LIBRARY.libraryID, "BULKPDF2")
        .lastInsertRowid,
    );
    sqlite
      .prepare(
        "insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path) values (?, ?, 0, 'application/pdf', 'storage:bulk.pdf')",
      )
      .run(attachmentID, parentID);
    const insertAnnotation = sqlite.prepare(
      "insert into itemAnnotations (itemID, parentItemID, type, text, sortIndex, position, isExternal) values (?, ?, ?, ?, ?, ?, 0)",
    );
    for (let index = 0; index < count; index++) {
      const itemID = Number(
        insertItem.run(
          annotationTypeID,
          BULK_LIBRARY.libraryID,
          `ANN${bulkItemKey(index).slice(3)}`,
        ).lastInsertRowid,
      );
      insertAnnotation.run(
        itemID,
        attachmentID,
        index % 5 === 0 ? 3 : 1,
        `Annotation ${index}`,
        String(index).padStart(8, "0"),
        '{"pageIndex":0,"rects":[[0,0,10,10]]}',
      );
    }
    sqlite.exec("commit");
  } catch (error) {
    sqlite.exec("rollback");
    throw error;
  }
}
