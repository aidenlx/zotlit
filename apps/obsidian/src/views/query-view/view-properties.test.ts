import { describe, expect, it } from "vitest";

import { DATASETS } from "./datasets";
import { parseQueryFile } from "./query-file";
import { fieldLabel, viewProperties } from "./view-properties";

const FILE = parseQueryFile(`formulas:
  year: date.year
  pages: numPages * 2
properties:
  title:
    displayName: Work
  formula.year:
    displayName: Year of source
views:
  - type: table
    name: Items
    from: items
    order:
      - title
      - formula.pages
      - date
`);
const VIEW = FILE.views[0]!;

const entryOf = (path: string, faults = {}) =>
  viewProperties(FILE, VIEW, faults).entries.find(
    (entry) => entry.path === path,
  );

describe("viewProperties labels", () => {
  it("names a Property by its Display Name, else its field label, else its path", () => {
    expect(entryOf("title")?.label).toBe("Work");
    expect(entryOf("formula.year")?.label).toBe("Year of source");
    expect(entryOf("date")?.label).toBe("Date");
    expect(entryOf("formula.pages")?.label).toBe("formula.pages");
  });
});

describe("viewProperties entries", () => {
  it("lists the Visible Properties in order, then the other Formula Properties, then the other dataset fields", () => {
    const { entries } = viewProperties(FILE, VIEW);
    expect(entries.slice(0, 4).map((entry) => entry.path)).toEqual([
      "title",
      "formula.pages",
      "date",
      "formula.year",
    ]);
    expect(entries.slice(0, 4).map((entry) => entry.place)).toEqual([
      0,
      1,
      2,
      null,
    ]);
    expect(entries.map((entry) => entry.path)).toContain("itemType");
    expect(entries.find((entry) => entry.path === "itemType")?.place).toBe(
      null,
    );
  });

  it("finds a Property that is not visible by its Display Name", () => {
    expect(entryOf("formula.year")).toMatchObject({
      label: "Year of source",
      place: null,
      formula: "year",
    });
  });

  it("marks a Formula Property with the message of its fault", () => {
    const faults = { pages: "numPages is not a field of Items." };
    expect(entryOf("formula.pages", faults)).toMatchObject({
      formula: "pages",
      issue: "numPages is not a field of Items.",
    });
    expect(entryOf("formula.year", faults)?.issue).toBe(null);
    expect(entryOf("title", faults)).toMatchObject({
      formula: null,
      issue: null,
    });
  });

  it("marks a Formula in the Visible Properties that the file does not define with its fault", () => {
    const view = { from: "items" as const, order: ["formula.gone"] };
    const properties = viewProperties(FILE, view, {
      gone: "The formula gone has no definition.",
    });
    expect(properties.entries[0]).toMatchObject({
      path: "formula.gone",
      formula: "gone",
      issue: "The formula gone has no definition.",
      fits: true,
      place: 0,
    });
  });

  it("says whether the view's dataset can read a Property, and shows only those it can", () => {
    const view = {
      from: "items" as const,
      order: ["comment", "title", 'custom["Reading status"]'],
    };
    const properties = viewProperties(FILE, view);
    expect(properties.entry("comment").fits).toBe(false);
    expect(properties.entries.map((entry) => entry.path)).not.toContain(
      "comment",
    );
    expect(properties.visible.map((entry) => entry.path)).toEqual([
      "title",
      'custom["Reading status"]',
    ]);
    expect(properties.unused.order).toEqual(["comment"]);
  });
});

/** The paths the Properties popover ticks: the entries with a place, by place. */
const ticked = ({ entries }: ReturnType<typeof viewProperties>) =>
  entries
    .filter((entry) => entry.place !== null)
    .toSorted((a, b) => a.place! - b.place!)
    .map((entry) => entry.path);

describe("viewProperties visible", () => {
  const paths = (properties: ReturnType<typeof viewProperties>) =>
    properties.visible.map((entry) => entry.path);

  it("shows the default fields for a view without order, and ticks them", () => {
    const properties = viewProperties(null, { from: "items" });
    // The default fields that give one cell each, as the Table shows them.
    expect(paths(properties)).toEqual(["itemType", "title", "dateModified"]);
    expect(ticked(properties)).toEqual(paths(properties));
    expect(properties.entries[3]).toMatchObject({
      path: "abstractNote",
      place: null,
    });
    expect(properties.orderOf(["title"])).toEqual(["title"]);
  });

  it("shows and ticks nothing for an empty order, as Hide all leaves it", () => {
    const properties = viewProperties(null, { from: "items", order: [] });
    expect(properties.visible).toEqual([]);
    expect(ticked(properties)).toEqual([]);
  });

  it("shows and ticks the default fields for an order of another dataset, and keeps that order on a change", () => {
    const view = { from: "annotations" as const, order: ["title"] };
    const properties = viewProperties(null, view);
    const columns = paths(properties);
    expect(columns.slice(0, 3)).toEqual(["type", "text", "comment"]);
    expect(columns).toContain("item.title");
    expect(ticked(properties)).toEqual(columns);
    expect(properties.unused.order).toEqual(["title"]);

    // A tick shows the ticked fields and keeps "title" for the Items.
    const order = properties.orderOf(["text"]);
    expect(order).toEqual(["text", "title"]);
    expect(paths(viewProperties(null, { ...view, order }))).toEqual(["text"]);
    // "Hide all" shows none.
    expect(properties.orderOf([])).toEqual([]);
  });

  it("shows and ticks the Properties of a mixed order that the dataset can read, in order", () => {
    const view = {
      from: "items" as const,
      order: ["comment", "title", "formula.pages", "title"],
    };
    const properties = viewProperties(FILE, view);
    expect(paths(properties)).toEqual(["title", "formula.pages"]);
    expect(ticked(properties)).toEqual(paths(properties));
    expect(properties.visible.map((entry) => entry.place)).toEqual([0, 1]);

    const order = properties.orderOf(["formula.pages", "title", "date"]);
    expect(order).toEqual(["formula.pages", "title", "date", "comment"]);
    const next = viewProperties(FILE, { ...view, order });
    expect(paths(next)).toEqual(["formula.pages", "title", "date"]);
    expect(ticked(next)).toEqual(paths(next));
  });
});

describe("viewProperties entry", () => {
  it("names a Property it does not list, such as a sort of another dataset", () => {
    const properties = viewProperties(FILE, VIEW);
    expect(properties.entry("pageIndex")).toMatchObject({
      path: "pageIndex",
      fits: false,
      place: null,
    });
    expect(properties.entry("title").label).toBe("Work");
  });
});

describe("viewProperties dataset fields", () => {
  const paths = (dataset: "annotations" | "items") =>
    viewProperties(null, { from: dataset }).entries.map((entry) => entry.path);

  it("lists the fields of Annotations and of their parent Item and Attachment", () => {
    expect(paths("annotations")).toEqual(
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
    const properties = paths("annotations");
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
    expect(paths("items")).toEqual(
      expect.arrayContaining(["title", "itemType", "firstAuthor.fullName"]),
    );
    expect(paths("items")).not.toContain("creators");
  });
});

describe("fieldLabel", () => {
  it.each([
    // Zotero's own label for an Item field.
    ["title", "Title"],
    ["DOI", "DOI"],
    // The Query Dataset's label where Zotero has none.
    ["item.title", "Item title"],
    ["colorName", "Color"],
    ["attachment.title", "Attachment title"],
    ["tags", "Tag"],
    // A field of the Item or the Attachment, under its parent's name.
    ["item.publicationTitle", "Item publication"],
    ["item.DOI", "Item DOI"],
    ["item.archiveID", "Item archive ID"],
    ["item.dateAdded", "Item date added"],
    ["item.itemType", "Item type"],
    // A path no label covers stays as it is.
    ["attachment.contentType", "attachment.contentType"],
  ])("names %s as %s", (property, label) => {
    expect(fieldLabel(property)).toBe(label);
  });

  it.each(Object.entries(DATASETS))(
    "names every property %s sort and group by",
    (dataset, spec) => {
      const paths = [
        ...spec.sort.map(([path, label]) => [path, label()] as const),
        ...spec.group.map(({ path, label }) => [path, label()] as const),
      ].filter(([path]) =>
        viewProperties(null, {
          from: dataset as keyof typeof DATASETS,
        }).entries.some((entry) => entry.path === path),
      );
      expect(paths.length).toBeGreaterThan(0);
      for (const [path] of paths) expect(fieldLabel(path)).not.toBe(path);
    },
  );
});
