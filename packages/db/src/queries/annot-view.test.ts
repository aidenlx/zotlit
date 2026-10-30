import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NodeDatabaseClient } from "@/client/node";
import { createFixtureSchema } from "@/test-utils";

import {
  getAnnotViewAttachments,
  getAttachmentAnnotationCount,
} from "./annot-view";

const INSERTS = `
  insert into libraries (libraryID, type) values (1, 'user');

  insert into items (itemID, libraryID, key) values (100, 1, 'DOCITEM1');

  insert into items (itemID, libraryID, key) values (200, 1, 'ATCH0001');
  insert into itemAttachments (itemID, parentItemID, path)
    values (200, 100, 'storage:test.pdf');

  insert into items (itemID, libraryID, key) values (300, 1, 'ANN00001');
  insert into itemAnnotations (itemID, parentItemID, type, text, sortIndex, position)
    values (300, 200, 1, 'visible highlight', '00000|000000|00001', '{}');

  insert into items (itemID, libraryID, key) values (301, 1, 'ANN00002');
  insert into itemAnnotations (itemID, parentItemID, type, text, sortIndex, position)
    values (301, 200, 1, 'trashed highlight', '00000|000000|00002', '{}');
  insert into deletedItems (itemID) values (301);

  insert into tags (tagID, name) values (1, 'test-tag');
  insert into itemTags (itemID, tagID, type) values (300, 1, 0);
`;

let sqlite: DatabaseSync;
let db: NodeDatabaseClient;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  createFixtureSchema(sqlite);
  sqlite.exec(INSERTS);
  db = drizzle({ client: sqlite, relations });
});

afterEach(() => {
  sqlite.close();
});

describe("getAnnotViewAttachments", () => {
  it("returns attachments with annotation count excluding trashed", () => {
    const result = getAnnotViewAttachments(db, "DOCITEM1", 1);

    expect(result).toHaveLength(1);
    expect(result[0]!.itemID).toBe(200);
    expect(result[0]!.indexedKey).toBe("ATCH0001");
    expect(result[0]!.path).toBe("storage:test.pdf");
    expect(result[0]!.annotCount).toBe(1);
  });

  it("returns empty for unknown key", () => {
    expect(getAnnotViewAttachments(db, "ZZZZZZZZ", 1)).toEqual([]);
  });
});

describe("getAttachmentAnnotationCount", () => {
  it("counts the live annotations the picker labels an attachment with", () => {
    expect(getAttachmentAnnotationCount(db, 200)).toBe(1);
  });

  it("excludes trashed annotations, as the attachment list's own count does", () => {
    // The seed holds two annotations on itemID 200, one of them trashed.
    expect(getAnnotViewAttachments(db, "DOCITEM1", 1)[0]!.annotCount).toBe(1);
    expect(getAttachmentAnnotationCount(db, 200)).toBe(1);
  });

  it("answers zero for an attachment the database does not hold", () => {
    expect(getAttachmentAnnotationCount(db, 999)).toBe(0);
  });
});

describe("group libraries", () => {
  beforeEach(() => {
    sqlite.exec(`
      insert into libraries (libraryID, type) values (2, 'group');
      insert into groups (groupID, libraryID, name)
        values (4200309, 2, 'Shared Reading');

      insert into items (itemID, libraryID, key) values (400, 2, 'GRPITEM1');
      insert into items (itemID, libraryID, key) values (500, 2, 'GRPATCH1');
      insert into itemAttachments (itemID, parentItemID, path)
        values (500, 400, 'storage:shared.pdf');
      insert into items (itemID, libraryID, key) values (600, 2, 'GRPANN01');
      insert into itemAnnotations (itemID, parentItemID, type, text, sortIndex, position)
        values (600, 500, 1, 'shared highlight', '00000|000000|00001', '{}');
    `);
  });

  it("suffixes both Indexed Keys with the group id", () => {
    const attachments = getAnnotViewAttachments(db, "GRPITEM1", 2);
    expect(attachments.map((a) => a.indexedKey)).toEqual(["GRPATCH1g4200309"]);

    expect(getAttachmentAnnotationCount(db, 500)).toBe(1);
  });
});
