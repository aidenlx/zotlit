import { Effect } from "effect";
import { expect, it } from "vitest";

import {
  BULK_LIBRARY,
  bulkItemKey,
  openScenarioDatabase,
  seedBulkAnnotations,
  seedBulkLibrary,
} from "@/test-scenario";

import {
  ItemQueryDatabase,
  readItemAttachments,
  readItemAnnotations,
  readAttachmentAnnotations,
  readItemNotes,
} from ".";
import type { AnnotationScanRow } from ".";

it("reads a paper's files and marks in source order, excluding trash and standalone files", () => {
  using scenario = openScenarioDatabase({ annotations: true });
  const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
    Effect.runSync(
      Effect.provideService(effect, ItemQueryDatabase, { client: scenario.db }),
    );
  const ids = (
    scenario.sqlite
      .prepare("select itemID from items where libraryID = 1")
      .all() as { itemID: number }[]
  ).map((row) => row.itemID);
  expect(run(readItemAttachments(ids)).map((row) => row.key)).toEqual([
    "PDF2LINK",
    "PDF2LIVE",
    "URL2LIVE",
    "WEB2LIVE",
  ]);
  const marks = [
    "ANN2LINK",
    "ANN2BAD2",
    "ANL2IMAG",
    "ANL2INK2",
    "ANL2UNDR",
    "ANL2TEXT",
    "ANN2HGHT",
    "ANN2NOTE",
    "ANN2IMAG",
    "ANN2INK2",
    "ANN2UNDR",
    "ANN2TEXT",
  ];
  expect(run(readItemAnnotations(ids)).map((row) => row.key)).toEqual(marks);
  expect(run(readAttachmentAnnotations(ids)).map((row) => row.key)).toEqual(
    marks,
  );
});

it("reads a long Relation List in keyset pages of 500 rows", () => {
  using scenario = openScenarioDatabase();
  const { sqlite } = scenario;
  seedBulkLibrary(sqlite, 1);
  seedBulkAnnotations(sqlite, 1_001);
  const lookup = (key: string) =>
    (
      sqlite.prepare("select itemID from items where key = ?").get(key) as {
        itemID: number;
      }
    ).itemID;
  const paper = lookup(bulkItemKey(0));
  const pdf = lookup("BULKPDF2");
  const attachmentType = (
    sqlite
      .prepare(
        "select itemTypeID from itemTypesCombined where typeName = 'attachment'",
      )
      .get() as { itemTypeID: number }
  ).itemTypeID;
  // 499 more files on the paper make 500 with the PDF: one full page.
  const fileKeys = Array.from(
    { length: 499 },
    (_, index) => `FIL${bulkItemKey(index).slice(3)}`,
  );
  for (const key of fileKeys) {
    const itemID = Number(
      sqlite
        .prepare(
          "insert into items (itemTypeID, libraryID, key) values (?, ?, ?)",
        )
        .run(attachmentType, BULK_LIBRARY.libraryID, key).lastInsertRowid,
    );
    sqlite
      .prepare(
        "insert into itemAttachments (itemID, parentItemID, linkMode) values (?, ?, 1)",
      )
      .run(itemID, paper);
  }
  const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
    Effect.runSync(
      Effect.provideService(effect, ItemQueryDatabase, { client: scenario.db }),
    );
  const keys = (rows: readonly { key: string }[]) => rows.map((row) => row.key);

  // The seed gives Annotation `index` the sort index `index`.
  const marks = Array.from(
    { length: 1_001 },
    (_, index) => `ANN${bulkItemKey(index).slice(3)}`,
  );
  const pages = [
    marks.slice(0, 500),
    marks.slice(500, 1_000),
    marks.slice(1_000),
  ];
  for (const read of [
    (after?: AnnotationScanRow) => readItemAnnotations([paper], after),
    (after?: AnnotationScanRow) => readAttachmentAnnotations([pdf], after),
  ]) {
    const first = run(read());
    const second = run(read(first.at(-1)));
    const third = run(read(second.at(-1)));
    expect([first, second, third].map(keys)).toEqual(pages);
  }

  // "BULKPDF2" sorts before every "FIL" key; after a full page, the next is
  // empty.
  const files = run(readItemAttachments([paper]));
  expect(keys(files)).toEqual(["BULKPDF2", ...fileKeys]);
  expect(run(readItemAttachments([paper], files.at(-1)))).toEqual([]);
});

it("reads a paper's Child Notes in keyset pages of 500 rows", () => {
  using scenario = openScenarioDatabase();
  const { sqlite } = scenario;
  seedBulkLibrary(sqlite, 1);
  const paper = (
    sqlite
      .prepare("select itemID from items where key = ?")
      .get(bulkItemKey(0)) as { itemID: number }
  ).itemID;
  const noteType = (
    sqlite
      .prepare(
        "select itemTypeID from itemTypesCombined where typeName = 'note'",
      )
      .get() as { itemTypeID: number }
  ).itemTypeID;
  // 501 notes: one full page, then a page of one.
  const noteKeys = Array.from(
    { length: 501 },
    (_, index) => `NOT${bulkItemKey(index).slice(3)}`,
  );
  for (const key of noteKeys) {
    const itemID = Number(
      sqlite
        .prepare(
          "insert into items (itemTypeID, libraryID, key) values (?, ?, ?)",
        )
        .run(noteType, BULK_LIBRARY.libraryID, key).lastInsertRowid,
    );
    sqlite
      .prepare(
        "insert into itemNotes (itemID, parentItemID, note, title) values (?, ?, '', ?)",
      )
      .run(itemID, paper, key);
  }
  const run = <A, E>(effect: Effect.Effect<A, E, ItemQueryDatabase>) =>
    Effect.runSync(
      Effect.provideService(effect, ItemQueryDatabase, { client: scenario.db }),
    );
  const keys = (rows: readonly { key: string }[]) => rows.map((row) => row.key);

  const first = run(readItemNotes([paper]));
  const second = run(readItemNotes([paper], first.at(-1)));
  expect([keys(first), keys(second)]).toEqual([
    noteKeys.slice(0, 500),
    noteKeys.slice(500),
  ]);
});
