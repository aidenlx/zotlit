import { describe, expect, it } from "vitest";

import type { QueryViewRow } from "@/services/item-query/query-view";

import { layoutRows } from "./rows";

function row(
  key: string,
  item: string | undefined,
  {
    itemTitle,
    attachment = "ATTACHMT",
  }: {
    itemTitle: string | null;
    attachment?: string;
  },
): QueryViewRow {
  return {
    indexedKey: key,
    attachmentIndexedKey: attachment,
    ...(item === undefined ? {} : { itemIndexedKey: item }),
    values: { "item.title": itemTitle, "attachment.title": "Full text PDF" },
  };
}

const ROWS = [
  row("ANNOT001", "ITEMBBBB", { itemTitle: "Ten simple rules" }),
  row("ANNOT002", "ITEMAAAA", { itemTitle: "Deep learning" }),
  row("ANNOT003", "ITEMBBBB", { itemTitle: "Ten simple rules" }),
  row("ANNOT004", undefined, { itemTitle: null, attachment: "STANDALN" }),
];

describe("layoutRows", () => {
  it("keeps the query's order when the view has no grouping", () => {
    expect(layoutRows(ROWS, undefined).map((r) => r.annotationKey)).toEqual([
      "ANNOT001",
      "ANNOT002",
      "ANNOT003",
      "ANNOT004",
    ]);
    expect(layoutRows(ROWS, undefined).every((r) => !r.group)).toBe(true);
  });

  it("groups by Item in the order each Item first shows, named by its title", () => {
    const rows = layoutRows(ROWS, {
      property: "item.indexedKey",
      direction: "ASC",
    });
    expect(
      rows.map((r) => [r.annotationKey, r.attachmentKey, r.group?.label]),
    ).toEqual([
      ["ANNOT001", "ATTACHMT", "Ten simple rules"],
      ["ANNOT003", "ATTACHMT", "Ten simple rules"],
      ["ANNOT002", "ATTACHMT", "Deep learning"],
      // A standalone Attachment has no Item: it stands under its own title.
      ["ANNOT004", "STANDALN", "Full text PDF"],
    ]);
  });

  it("reverses the groups for a descending grouping", () => {
    const rows = layoutRows(ROWS, {
      property: "item.indexedKey",
      direction: "DESC",
    });
    expect(rows.map((r) => r.annotationKey)).toEqual([
      "ANNOT004",
      "ANNOT002",
      "ANNOT001",
      "ANNOT003",
    ]);
  });
});
