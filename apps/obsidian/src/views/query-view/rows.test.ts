import { describe, expect, it } from "vitest";

import type { QueryViewRow } from "@/services/item-query/query-view";

import { layoutRows } from "./rows";

function row(
  key: string,
  item: string | undefined,
  {
    itemTitle,
    attachment = "ATTACHMT",
    color = "#ffd400",
    colorName = "yellow",
    tags = [],
    collections = [],
  }: {
    itemTitle: string | null;
    attachment?: string;
    color?: string;
    colorName?: string | null;
    tags?: string[];
    collections?: string[];
  },
): QueryViewRow {
  return {
    indexedKey: key,
    attachmentIndexedKey: attachment,
    ...(item === undefined ? {} : { itemIndexedKey: item }),
    values: {
      "item.title": itemTitle,
      "attachment.title": "Full text PDF",
      color,
      colorName,
      tags,
      "item.collections": collections,
    },
  };
}

const ROWS = [
  row("ANNOT001", "ITEMBBBB", { itemTitle: "Ten simple rules" }),
  row("ANNOT002", "ITEMAAAA", { itemTitle: "Deep learning" }),
  row("ANNOT003", "ITEMBBBB", { itemTitle: "Ten simple rules" }),
  row("ANNOT004", undefined, { itemTitle: null, attachment: "STANDALN" }),
];

const placed = (shown: ReturnType<typeof layoutRows>) =>
  shown.rows.map((r) => [r.annotationKey, r.group?.label]);

describe("layoutRows", () => {
  it("keeps the query's order when the view has no grouping", () => {
    const shown = layoutRows(ROWS, undefined);
    expect(shown.rows.map((r) => r.annotationKey)).toEqual([
      "ANNOT001",
      "ANNOT002",
      "ANNOT003",
      "ANNOT004",
    ]);
    expect(shown.rows.every((r) => !r.group)).toBe(true);
    expect(shown.groups).toEqual([]);
    expect(shown.count).toBe(4);
  });

  it("groups by Item in the order each Item first shows, named by its title", () => {
    const shown = layoutRows(ROWS, {
      property: "item.indexedKey",
      direction: "ASC",
    });
    expect(
      shown.rows.map((r) => [r.annotationKey, r.attachmentKey, r.group?.label]),
    ).toEqual([
      ["ANNOT001", "ATTACHMT", "Ten simple rules"],
      ["ANNOT003", "ATTACHMT", "Ten simple rules"],
      ["ANNOT002", "ATTACHMT", "Deep learning"],
      // A standalone Attachment has no Item: it stands under its own title.
      ["ANNOT004", "STANDALN", "Full text PDF"],
    ]);
  });

  it("reverses the groups for a descending grouping", () => {
    const shown = layoutRows(ROWS, {
      property: "item.indexedKey",
      direction: "DESC",
    });
    expect(shown.rows.map((r) => r.annotationKey)).toEqual([
      "ANNOT004",
      "ANNOT002",
      "ANNOT001",
      "ANNOT003",
    ]);
  });

  it("groups by Attachment, named by its title", () => {
    const shown = layoutRows(ROWS, {
      property: "attachment.indexedKey",
      direction: "ASC",
    });
    expect(shown.groups.map((g) => [g.value, g.label, g.count])).toEqual([
      ["ATTACHMT", "Full text PDF", 3],
      ["STANDALN", "Full text PDF", 1],
    ]);
  });

  it("groups by colour, named by the colour", () => {
    const shown = layoutRows(
      [
        row("ANNOT001", "ITEMAAAA", { itemTitle: "A" }),
        row("ANNOT002", "ITEMAAAA", {
          itemTitle: "A",
          color: "#ff6666",
          colorName: "red",
        }),
        row("ANNOT003", "ITEMAAAA", {
          itemTitle: "A",
          color: "#123456",
          colorName: null,
        }),
      ],
      { property: "colorName", direction: "ASC" },
    );
    expect(placed(shown)).toEqual([
      ["ANNOT001", "Yellow"],
      ["ANNOT002", "Red"],
      // A colour outside Zotero's palette is its own group, named by its hex.
      ["ANNOT003", "#123456"],
    ]);
    expect(shown.groups.map((g) => g.value)).toEqual([
      "yellow",
      "red",
      "#123456",
    ]);
  });

  it("shows a card with two tags in both tag groups, and counts it once", () => {
    const shown = layoutRows(
      [
        row("ANNOT001", "ITEMAAAA", {
          itemTitle: "A",
          tags: ["figure", "method"],
        }),
        row("ANNOT002", "ITEMAAAA", { itemTitle: "A", tags: ["method"] }),
        row("ANNOT003", "ITEMAAAA", { itemTitle: "A" }),
      ],
      { property: "tags[]", direction: "ASC" },
    );
    expect(placed(shown)).toEqual([
      ["ANNOT001", "figure"],
      ["ANNOT001", "method"],
      ["ANNOT002", "method"],
      ["ANNOT003", "No value"],
    ]);
    expect(shown.groups.map((g) => [g.value, g.count])).toEqual([
      ["figure", 1],
      ["method", 2],
      [null, 1],
    ]);
    expect(shown.count).toBe(3);
  });

  it("groups by collection path, with the Item's every collection", () => {
    const shown = layoutRows(
      [
        row("ANNOT001", "ITEMAAAA", {
          itemTitle: "A",
          collections: ["Thesis/Chapter 1", "Reading"],
        }),
      ],
      { property: "item.collections[]", direction: "ASC" },
    );
    expect(placed(shown)).toEqual([
      ["ANNOT001", "Thesis/Chapter 1"],
      ["ANNOT001", "Reading"],
    ]);
  });

  it("shows only the groups of a Manual group order, in its order", () => {
    const shown = layoutRows(
      [
        row("ANNOT001", "ITEMAAAA", { itemTitle: "A" }),
        row("ANNOT002", "ITEMAAAA", {
          itemTitle: "A",
          color: "#ff6666",
          colorName: "red",
        }),
        row("ANNOT003", "ITEMAAAA", {
          itemTitle: "A",
          color: "#5fb236",
          colorName: "green",
        }),
        row("ANNOT004", "ITEMAAAA", { itemTitle: "A" }),
      ],
      { property: "colorName", direction: "ASC" },
      ["red", "blue", "yellow"],
    );
    expect(placed(shown)).toEqual([
      ["ANNOT002", "Red"],
      ["ANNOT001", "Yellow"],
      ["ANNOT004", "Yellow"],
    ]);
    // Every group the rows hold, the shown ones first in their order; a value
    // of the order that no row holds has no group.
    expect(shown.groups.map((g) => [g.value, g.count, g.shown])).toEqual([
      ["red", 1, true],
      ["yellow", 2, true],
      ["green", 1, false],
    ]);
    expect(shown.count).toBe(3);
  });
});
