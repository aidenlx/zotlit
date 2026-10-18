import { describe, expect, it } from "vitest";

import type {
  QueryViewRow,
  QueryViewValue,
} from "@/services/item-query/query-view";

import type { QueryFileSort } from "./query-file";
import type { VaultValue } from "./table-notes";
import { limitRows, sortByVault } from "./vault-sort";

function item(
  key: string,
  values: Record<string, QueryViewValue>,
): QueryViewRow {
  return { indexedKey: key, values };
}

/** The vault of these tests: each Item's frontmatter, or no note. */
function reader(vault: Record<string, Record<string, unknown> | null>) {
  return (row: QueryViewRow, name: string): VaultValue => {
    const frontmatter = vault[row.indexedKey];
    return frontmatter
      ? { note: true, value: frontmatter[name] ?? null }
      : { note: false };
  };
}

const keys = (rows: readonly QueryViewRow[]) => rows.map((r) => r.indexedKey);

describe("sortByVault", () => {
  const VAULT = {
    ITEMAAAA: { status: "reading" },
    ITEMBBBB: { status: "Done" },
    ITEMCCCC: { status: null },
    ITEMDDDD: null,
    ITEMEEEE: { status: "abandoned" },
    ITEMFFFF: { status: "" },
  };
  const ROWS = Object.keys(VAULT).map((key) => item(key, {}));

  it.each([
    ["ASC", ["ITEMEEEE", "ITEMBBBB", "ITEMAAAA"]],
    ["DESC", ["ITEMAAAA", "ITEMBBBB", "ITEMEEEE"]],
  ] as const)(
    "orders by a vault property %s in the engine's string order, with empty values last",
    (direction, valued) => {
      const sorted = sortByVault(
        ROWS,
        [{ property: "vault.status", direction }],
        reader(VAULT),
      );
      expect(keys(sorted).slice(0, 3)).toEqual(valued);
      // A null, an empty string and no note are all empty, and keep the
      // engine's order among themselves.
      expect(keys(sorted).slice(3)).toEqual([
        "ITEMCCCC",
        "ITEMDDDD",
        "ITEMFFFF",
      ]);
    },
  );

  it("orders numbers by value and lists by their text", () => {
    const sorted = sortByVault(
      [
        item("ITEMAAAA", {}),
        item("ITEMBBBB", {}),
        item("ITEMCCCC", {}),
        item("ITEMDDDD", {}),
      ],
      [{ property: "vault.pages", direction: "ASC" }],
      reader({
        ITEMAAAA: { pages: 10 },
        ITEMBBBB: { pages: 9 },
        ITEMCCCC: { pages: [] },
        ITEMDDDD: { pages: 100 },
      }),
    );
    expect(keys(sorted)).toEqual([
      "ITEMBBBB",
      "ITEMAAAA",
      "ITEMDDDD",
      "ITEMCCCC",
    ]);
  });

  // The rows come in the engine's order of its sort keys; a date sorts by
  // its first day there, not by the value a row shows.
  const year = (y: number) => ({ kind: "year", year: y }) as QueryViewValue;
  const ENGINE_ROWS = [
    item("ITEMAAAA", { date: year(2001) }),
    item("ITEMBBBB", { date: year(2001) }),
    item("ITEMCCCC", { date: year(2010) }),
    item("ITEMDDDD", { date: year(2010) }),
    item("ITEMEEEE", { date: null }),
  ];
  const STATUS = reader({
    ITEMAAAA: { status: "b" },
    ITEMBBBB: { status: "a" },
    ITEMCCCC: { status: "a" },
    ITEMDDDD: { status: "b" },
    ITEMEEEE: { status: "a" },
  });

  it("orders a Zotero field then a vault property: the field as the engine ordered it, the vault property inside it", () => {
    const sort: QueryFileSort[] = [
      { property: "date", direction: "ASC" },
      { property: "vault.status", direction: "ASC" },
    ];
    expect(keys(sortByVault(ENGINE_ROWS, sort, STATUS))).toEqual([
      "ITEMBBBB",
      "ITEMAAAA",
      "ITEMCCCC",
      "ITEMDDDD",
      "ITEMEEEE",
    ]);
  });

  it("breaks a tie of the engine's sort key with the vault property, where the dates show differently", () => {
    // `2024` sorts as its 1 January in the engine, so it ties `2024-01-01`.
    const date = (raw: string, month: number | null, day: number | null) =>
      ({
        kind: day === null ? "year" : "day",
        value: raw,
        year: 2024,
        month,
        day,
        text: null,
        raw,
      }) as QueryViewValue;
    const rows = [
      item("ITEMAAAA", { date: date("2024", null, null) }),
      item("ITEMBBBB", { date: date("2024-01-01", 1, 1) }),
      item("ITEMCCCC", { date: date("2024-02-01", 2, 1) }),
    ];
    const sort: QueryFileSort[] = [
      { property: "date", direction: "ASC" },
      { property: "vault.rating", direction: "ASC" },
    ];
    const rating = reader({
      ITEMAAAA: { rating: 5 },
      ITEMBBBB: { rating: 1 },
      ITEMCCCC: { rating: 0 },
    });

    expect(keys(sortByVault(rows, sort, rating))).toEqual([
      "ITEMBBBB",
      "ITEMAAAA",
      "ITEMCCCC",
    ]);
  });

  it("orders a vault property then a Zotero field: the field as the engine ordered it, inside each vault value", () => {
    const sort: QueryFileSort[] = [
      { property: "vault.status", direction: "DESC" },
      { property: "date", direction: "DESC" },
    ];
    // The engine ran the date DESC, so its rows come newest first.
    const engine = [
      ENGINE_ROWS[2]!,
      ENGINE_ROWS[3]!,
      ENGINE_ROWS[0]!,
      ENGINE_ROWS[1]!,
      ENGINE_ROWS[4]!,
    ];
    expect(keys(sortByVault(engine, sort, STATUS))).toEqual([
      "ITEMDDDD",
      "ITEMAAAA",
      "ITEMCCCC",
      "ITEMBBBB",
      "ITEMEEEE",
    ]);
  });
});

describe("limitRows", () => {
  const row = (key: string, group?: string) => ({
    annotationKey: key,
    attachmentKey: key,
    ...(group !== undefined && { group: { key: group, label: group } }),
  });

  it("keeps the first `limit` rows of an ungrouped list, and says it dropped some", () => {
    const { rows, dropped } = limitRows([row("A"), row("B"), row("C")], 2);
    expect(rows.map((r) => r.annotationKey)).toEqual(["A", "B"]);
    expect(dropped).toBe(true);
  });

  it("keeps the first `limit` rows of each group", () => {
    const { rows, dropped } = limitRows(
      [row("A", "x"), row("B", "x"), row("C", "x"), row("D", "y")],
      2,
    );
    expect(rows.map((r) => r.annotationKey)).toEqual(["A", "B", "D"]);
    expect(dropped).toBe(true);
  });

  it("keeps every row with no limit, or with fewer rows than it", () => {
    expect(limitRows([row("A")], null).dropped).toBe(false);
    expect(limitRows([row("A")], 1)).toEqual({
      rows: [row("A")],
      dropped: false,
    });
  });
});
