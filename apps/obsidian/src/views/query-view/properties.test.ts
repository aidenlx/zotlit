import { describe, expect, it } from "vitest";

import { groupOptions, sortOptions } from "./properties";

const paths = (options: { path: string }[]) => options.map(({ path }) => path);

describe("sortOptions and groupOptions", () => {
  it("offers the fields of Items to a view of Items", () => {
    expect(paths(sortOptions("items"))).toEqual([
      "title",
      "firstAuthor",
      "date",
      "dateAdded",
      "dateModified",
      "itemType",
    ]);
    expect(paths(groupOptions("items"))).toEqual([
      "itemType",
      "tags[]",
      "collections[]",
    ]);
  });

  it("offers the fields of Attachments and their Items to a view of Attachments", () => {
    expect(paths(sortOptions("attachments"))).toEqual([
      "title",
      "dateAdded",
      "dateModified",
      "item.title",
      "item.firstAuthor",
      "item.date",
    ]);
    expect(paths(groupOptions("attachments"))).toEqual([
      "item.indexedKey",
      "tags[]",
      "item.collections[]",
    ]);
  });

  it("offers the fields of Annotations to a view that names no dataset", () => {
    expect(paths(sortOptions(undefined))).toContain("sortIndex");
    expect(paths(groupOptions(undefined))).toContain("colorName");
  });
});
