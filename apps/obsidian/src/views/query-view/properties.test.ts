import { describe, expect, it } from "vitest";

import {
  datasetProperties,
  propertyChoices,
  visibleProperties,
} from "./properties";

describe("visibleProperties", () => {
  it("gives the view's order", () => {
    expect(
      visibleProperties({ from: "annotations", order: ["item.title", "text"] }),
    ).toEqual(["item.title", "text"]);
  });

  it("gives the dataset's default properties for a view that names none, where asked", () => {
    expect(visibleProperties({ from: "annotations" })).toEqual([]);
    const fallback = visibleProperties(
      { from: "annotations", order: [] },
      { fallback: true },
    );
    expect(fallback.slice(0, 3)).toEqual(["type", "text", "comment"]);
    expect(fallback).toContain("item.title");
    expect(fallback).not.toContain("attachment");
  });
});

describe("datasetProperties", () => {
  it("lists the properties of Annotations and of their parent Item and Attachment", () => {
    const properties = datasetProperties("annotations");
    expect(properties).toEqual(
      expect.arrayContaining([
        "comment",
        "colorName",
        "pageLabel",
        "tags",
        "item.title",
        "item.date.year",
        "attachment.title",
      ]),
    );
  });

  it("leaves out records, list parts and positions, which have no single cell", () => {
    const properties = datasetProperties("annotations");
    for (const path of [
      "item",
      "attachment",
      "item.date",
      "item.creators",
      "tags[]",
    ])
      expect(properties).not.toContain(path);
    expect(properties.some((path) => path.endsWith(".length"))).toBe(false);
    expect(properties.some((path) => path.startsWith("position"))).toBe(false);
  });

  it("lists the Item fields of the items dataset", () => {
    expect(datasetProperties("items")).toEqual(
      expect.arrayContaining(["title", "itemType", "firstAuthor.fullName"]),
    );
    expect(datasetProperties("items")).not.toContain("creators");
  });
});

describe("propertyChoices", () => {
  const all = ["comment", "colorName", "tags", "item.title", "item.DOI"];

  it("shows the visible properties first in their order, then the record's own properties", () => {
    expect(propertyChoices(all, ["item.title", "comment"], "")).toEqual([
      "item.title",
      "comment",
      "colorName",
      "tags",
    ]);
  });

  it("offers the parent properties too while the user searches", () => {
    expect(propertyChoices(all, ["comment"], "doi")).toEqual([
      "comment",
      "colorName",
      "tags",
      "item.title",
      "item.DOI",
    ]);
  });

  it("keeps a visible property the dataset does not list", () => {
    expect(propertyChoices(all, ["item.creators[].lastName"], "")).toEqual([
      "item.creators[].lastName",
      "comment",
      "colorName",
      "tags",
    ]);
  });
});
