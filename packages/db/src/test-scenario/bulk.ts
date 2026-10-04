// A Library large enough to need several statements on every plan path: the
// responsiveness invariants of Item Query run on it. It is separate from the
// scenario Items, whose tests pin exact rows.
import type { DatabaseSync } from "node:sqlite";

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
  const idOf = (sql: string, name: string): number =>
    (sqlite.prepare(sql).get(name) as { id: number }).id;
  const itemTypeID = idOf(
    "select itemTypeID as id from itemTypesCombined where typeName = ?",
    "journalArticle",
  );
  const titleID = idOf(
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

    const start = Date.UTC(2021, 0, 1);
    for (let index = 0; index < count; index++) {
      const stamp = new Date(start + index * 1000)
        .toISOString()
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
