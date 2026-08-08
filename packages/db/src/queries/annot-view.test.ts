import { relations } from "@drizzle/relations";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NodeDatabaseClient } from "@/client/node";
import { createFixtureSchema } from "@/test-utils";

import { getAnnotViewAnnotations, getAnnotViewAttachments } from "./annot-view";

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
    expect(result[0]!.path).toBe("storage:test.pdf");
    expect(result[0]!.annotCount).toBe(1);
  });

  it("returns empty for unknown key", () => {
    expect(getAnnotViewAttachments(db, "ZZZZZZZZ", 1)).toEqual([]);
  });
});

describe("getAnnotViewAnnotations", () => {
  it("returns visible annotations with embedded tags", () => {
    const result = getAnnotViewAnnotations(db, 200);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      itemID: 300,
      key: "ANN00001",
      type: 1,
      text: "visible highlight",
      comment: null,
      color: null,
      pageLabel: null,
      parentKey: "ATCH0001",
      tags: [{ tagID: 1, name: "test-tag" }],
    });
  });

  it("excludes trashed annotations", () => {
    const result = getAnnotViewAnnotations(db, 200);
    expect(result.some((a) => a.key === "ANN00002")).toBe(false);
  });
});
