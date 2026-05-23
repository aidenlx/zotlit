import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { createClient } from "@/client/node";

import { getIndexedItemsByLibrary } from "./index-items";

const REAL_DB = "/Users/aidenlx/repo/zotlit-repo/1287.zotero.migrated.sqlite";
const LIBRARY_ID = 1;

const describeReal = existsSync(REAL_DB) ? describe : describe.skip;

describeReal("getIndexedItemsByLibrary", () => {
  it("resolves baseFieldMappingsCombined aliases to canonical columns", () => {
    const samples = aliasSamples("publicationTitle").slice(0, 5);
    expect(samples.length).toBeGreaterThan(0);

    const db = createClient(REAL_DB, { connection: { readOnly: true } });
    const byID = new Map(
      getIndexedItemsByLibrary(db, LIBRARY_ID).map((item) => [
        item.itemID,
        item,
      ]),
    );

    for (const sample of samples) {
      expect(byID.get(sample.itemID)?.publicationTitle).toBe(sample.value);
    }
  });

  it("orders indexed items by dateModified descending", () => {
    const db = createClient(REAL_DB, { connection: { readOnly: true } });
    const result = getIndexedItemsByLibrary(db, LIBRARY_ID);

    expect(result.length).toBeGreaterThan(0);
    for (let index = 1; index < result.length; index++) {
      expect(
        result[index - 1]!.dateModified.epochMilliseconds,
      ).toBeGreaterThanOrEqual(result[index]!.dateModified.epochMilliseconds);
    }
  });

  it("excludes child item types and tombstoned items", () => {
    const db = createClient(REAL_DB, { connection: { readOnly: true } });
    const result = getIndexedItemsByLibrary(db, LIBRARY_ID);
    const deleted = deletedItemIDs();

    expect(result.some((item) => deleted.has(item.itemID))).toBe(false);
    expect(
      result.some((item) =>
        ["attachment", "note", "annotation"].includes(item.itemType),
      ),
    ).toBe(false);
  });
});

interface AliasSample {
  itemID: number;
  value: string | null;
}

function aliasSamples(canonicalFieldName: string): AliasSample[] {
  const sqlite = new DatabaseSync(REAL_DB, { readOnly: true });
  try {
    return sqlite
      .prepare(
        `
          SELECT i.itemID, v.value
          FROM items i
          INNER JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
          INNER JOIN itemData d ON d.itemID = i.itemID
          INNER JOIN baseFieldMappingsCombined b
            ON b.itemTypeID = i.itemTypeID
           AND b.fieldID = d.fieldID
          INNER JOIN fieldsCombined base ON base.fieldID = b.baseFieldID
          LEFT JOIN itemDataValues v ON v.valueID = d.valueID
          LEFT JOIN deletedItems deleted ON deleted.itemID = i.itemID
          WHERE i.libraryID = ?
            AND base.fieldName = ?
            AND deleted.itemID IS NULL
            AND it.typeName NOT IN ('attachment', 'note', 'annotation')
          LIMIT 10
        `,
      )
      .all(LIBRARY_ID, canonicalFieldName) as unknown as AliasSample[];
  } finally {
    sqlite.close();
  }
}

function deletedItemIDs(): Set<number> {
  const sqlite = new DatabaseSync(REAL_DB, { readOnly: true });
  try {
    const rows = sqlite
      .prepare("SELECT itemID FROM deletedItems")
      .all() as unknown as { itemID: number }[];
    return new Set(rows.map((row) => row.itemID));
  } finally {
    sqlite.close();
  }
}
