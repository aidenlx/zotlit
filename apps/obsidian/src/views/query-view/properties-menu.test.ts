import { describe, expect, it } from "vitest";

import { chooserLayout } from "@/components/chooser-logic";
import type { ChooserMatcher } from "@/components/chooser-logic";

import { listedProperties, propertyRow } from "./properties-menu";
import { parseQueryFile } from "./query-file";
import { viewProperties } from "./view-properties";

const FILE = parseQueryFile(`formulas:
  year: date.year
properties:
  title:
    displayName: Work
  formula.year:
    displayName: Year of source
views:
  - type: table
    name: Items
    from: items
`);

/** The rows a search for `query` leaves, as a case-blind substring match. */
function search(rows: ReturnType<typeof propertyRow>[], query: string) {
  const matcher: ChooserMatcher = (text) =>
    text.toLowerCase().includes(query.toLowerCase()) ? { score: 0 } : null;
  return chooserLayout([{ items: rows }], matcher).rows.map((row) => row.value);
}

describe("propertyRow", () => {
  const properties = viewProperties(FILE, FILE.views[0]!);
  const rows = properties.entries.map(propertyRow);

  it("finds a property by its Display Name, its field label and its path, visible or not", () => {
    expect(properties.entry("formula.year").place).toBe(null);
    expect(search(rows, "Work")).toContain("title");
    expect(search(rows, "Work")).not.toContain("shortTitle");
    expect(search(rows, "Year of source")).toEqual(["formula.year"]);
    expect(search(rows, "formula.year")).toEqual(["formula.year"]);
    expect(search(rows, "title")).toEqual(
      expect.arrayContaining(["title", "shortTitle"]),
    );
  });
});

describe("listedProperties", () => {
  const view = { from: "annotations", order: ["type", "item.title"] } as const;
  const paths = (entries: { path: string }[]) => entries.map((e) => e.path);

  it("lists a nested property only while the view shows it or the user searches", () => {
    const shown = viewProperties(null, view);
    const hidden = viewProperties(null, { ...view, order: ["type"] });
    expect(paths(listedProperties(shown, ""))).toContain("item.title");
    expect(paths(listedProperties(hidden, ""))).not.toContain("item.title");
    expect(paths(listedProperties(hidden, "title"))).toContain("item.title");
    expect(paths(listedProperties(hidden, ""))).toContain("comment");
  });

  it("keeps each row of the last sort in its place when a tick hides a nested property", () => {
    const before = paths(listedProperties(viewProperties(null, view), ""));
    const after = viewProperties(null, { ...view, order: ["type"] });
    expect(paths(listedProperties(after, "", before))).toEqual(before);
  });

  it("puts a property the last sort lacked last, unless it is a hidden nested one", () => {
    const before = ["type"];
    const listed = paths(
      listedProperties(viewProperties(FILE, view), "", before),
    );
    expect(listed[0]).toBe("type");
    expect(listed).toContain("formula.year");
    expect(listed).toContain("item.title");
    expect(listed).not.toContain("item.citationKey");
  });

  it("keeps the row of a path the user typed when a tick hides it, unmarked", () => {
    const typed = { ...view, order: ["type", "myField"] };
    const before = paths(listedProperties(viewProperties(null, typed), ""));
    const after = viewProperties(null, { ...typed, order: ["type"] });
    expect(after.entries.some((e) => e.path === "myField")).toBe(false);
    const listed = listedProperties(after, "", before);
    expect(paths(listed)).toEqual(before);
    expect(listed.find((e) => e.path === "myField")).toMatchObject({
      place: null,
      fits: true,
      issue: null,
    });
  });

  it("drops the row of a Formula the file no longer defines", () => {
    const before = paths(listedProperties(viewProperties(FILE, view), ""));
    expect(before).toContain("formula.year");
    const after = viewProperties(
      parseQueryFile(
        "views:\n  - type: table\n    name: Items\n    from: items\n",
      ),
      view,
    );
    expect(paths(listedProperties(after, "", before))).not.toContain(
      "formula.year",
    );
  });
});
