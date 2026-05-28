import { relations } from "@drizzle/relations";
import * as schema from "@drizzle/schema";
import { drizzle } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type NodeDatabaseClient } from "@/client/node";
import { parseAnnotationPosition } from "@/lib/zt-annot-pos";

import { getAnnotationsByKey, getAnnotationsByParent } from "./annotations";

let sqlite: DatabaseSync;
let db: NodeDatabaseClient;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  seed(sqlite);
  db = drizzle({ client: sqlite, schema, relations });
});

afterEach(() => {
  sqlite.close();
});

describe("getAnnotationsByParent", () => {
  it("returns visible annotations sorted by sortIndex", () => {
    const result = getAnnotationsByParent(db, 9058, 1);

    expect(result).toHaveLength(6);
    expect(result.map((annotation) => annotation.key)).toEqual([
      "JDJKX3N6",
      "463QFRLZ",
      "V78IHLM9",
      "6P4FSYIT",
      "DZJSSBPX",
      "DBKE89L9",
    ]);
    expect(new Set(result.map((annotation) => annotation.type))).toEqual(
      new Set(["highlight", "note", "underline", "ink", "text", "image"]),
    );
    expect(result.some((annotation) => annotation.key === "TRASHED1")).toBe(
      false,
    );
    expect(
      result.every((annotation) => annotation.parentKey === "T2P8T29G"),
    ).toBe(true);
    expect(result.every((annotation) => annotation.isExternal === false)).toBe(
      true,
    );
    expect(typeof result[0]?.dateAdded.epochMilliseconds).toBe("number");
  });

  it("narrows fixture PDF positions", () => {
    const result = getAnnotationsByParent(db, 9058, 1);
    const kinds = Object.fromEntries(
      result.map((annotation) => [
        annotation.key,
        parseAnnotationPosition(annotation.position, "application/pdf").kind,
      ]),
    );

    expect(kinds).toEqual({
      JDJKX3N6: "pdf-rects",
      "463QFRLZ": "pdf-rects",
      V78IHLM9: "pdf-rects",
      "6P4FSYIT": "pdf-ink",
      DZJSSBPX: "pdf-text",
      DBKE89L9: "pdf-rects",
    });
  });
});

describe("getAnnotationsByKey", () => {
  it("returns requested visible annotation keys", () => {
    const result = getAnnotationsByKey(db, ["JDJKX3N6", "V78IHLM9"], 1);

    expect(result).toHaveLength(2);
    expect(result.map((annotation) => annotation.key)).toEqual([
      "JDJKX3N6",
      "V78IHLM9",
    ]);
  });

  it("returns an empty array for empty keys", () => {
    expect(getAnnotationsByKey(db, [], 1)).toEqual([]);
  });
});

function seed(sqlite: DatabaseSync): void {
  sqlite.exec(`
    create table items (
      itemID integer primary key,
      itemTypeID integer not null,
      dateAdded text not null,
      dateModified text not null,
      libraryID integer not null,
      key text not null
    );
    create table itemAttachments (
      itemID integer primary key,
      parentItemID integer,
      contentType text
    );
    create table itemAnnotations (
      itemID integer primary key,
      parentItemID integer not null,
      type integer not null,
      authorName text,
      text text,
      comment text,
      color text,
      pageLabel text,
      sortIndex text not null,
      position text not null,
      isExternal integer not null
    );
    create table deletedItems (
      itemID integer primary key,
      dateDeleted text not null
    );

    insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
      values
        (9058, 3, '2025-05-27 14:44:51', '2025-05-27 14:44:51', 1, 'T2P8T29G'),
        (9060, 4, '2026-05-28 02:20:36', '2026-05-28 02:20:45', 1, 'JDJKX3N6'),
        (9061, 4, '2026-05-28 02:20:54', '2026-05-28 02:20:54', 1, 'V78IHLM9'),
        (9062, 4, '2026-05-28 02:21:00', '2026-05-28 02:21:00', 1, 'DBKE89L9'),
        (9063, 4, '2026-05-28 02:21:01', '2026-05-28 02:21:05', 1, '463QFRLZ'),
        (9064, 4, '2026-05-28 02:21:10', '2026-05-28 02:21:10', 1, '6P4FSYIT'),
        (9065, 4, '2026-05-28 02:21:16', '2026-05-28 02:21:19', 1, 'DZJSSBPX'),
        (9066, 4, '2026-05-28 02:22:00', '2026-05-28 02:22:00', 1, 'TRASHED1');

    insert into itemAttachments (itemID, contentType)
      values (9058, 'application/pdf');

    insert into itemAnnotations (
      itemID,
      parentItemID,
      type,
      authorName,
      text,
      comment,
      color,
      pageLabel,
      sortIndex,
      position,
      isExternal
    )
      values
        (
          9060,
          9058,
          1,
          null,
          'Interrogation of Responses to Stated Choice  Experiments',
          'hello',
          '#ff6666',
          '62',
          '00000|000000|00146',
          '{"pageIndex":0,"rects":[[124.58,629.129,484.652,645.145],[160.1,609.569,262.204,625.585]]}',
          0
        ),
        (
          9061,
          9058,
          5,
          null,
          'dents tell',
          null,
          '#ffd400',
          '62',
          '00000|000073|00185',
          '{"pageIndex":0,"rects":[[278.296,590.129,352.88,606.145]]}',
          0
        ),
        (
          9062,
          9058,
          3,
          null,
          null,
          null,
          '#ffd400',
          '62',
          '00000|002078|00072',
          '{"pageIndex":0,"rects":[[219.605,682.31,450.971,719.175]]}',
          0
        ),
        (
          9063,
          9058,
          2,
          null,
          null,
          'a note test',
          '#ffd400',
          '62',
          '00000|000037|00136',
          '{"pageIndex":0,"rects":[[520.712,633.993,542.712,655.993]]}',
          0
        ),
        (
          9064,
          9058,
          4,
          null,
          null,
          null,
          '#2ea8e5',
          '62',
          '00000|000086|00206',
          '{"pageIndex":0,"width":2,"paths":[[51.792,585.738,50.802,584.466]]}',
          0
        ),
        (
          9065,
          9058,
          6,
          null,
          null,
          'text comment',
          null,
          '62',
          '00000|000129|00241',
          '{"pageIndex":0,"fontSize":14,"rotation":0,"rects":[[475.86,533.671,570.86,550.671]]}',
          0
        ),
        (
          9066,
          9058,
          1,
          null,
          'trashed highlight',
          null,
          '#ffd400',
          '62',
          '00000|000010|00010',
          '{"pageIndex":0,"rects":[[1,2,3,4]]}',
          0
        );

    insert into deletedItems (itemID, dateDeleted)
      values (9066, '2026-05-28 02:22:01');
  `);
}
