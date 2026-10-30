import { describe, expect, it } from "vitest";

import { groupOptions, sortOptions } from "./properties";
import { parseQueryFile } from "./query-file";
import { viewProperties } from "./view-properties";

const paths = (options: { path: string }[]) => options.map(({ path }) => path);

describe("sortOptions and groupOptions", () => {
  it("offers the fields of Annotations to a view that names no dataset", () => {
    expect(paths(sortOptions(undefined))).toContain("sortIndex");
    expect(paths(groupOptions(undefined))).toContain("colorName");
  });

  it("names each option by the label of the view's Property entry", () => {
    const file = parseQueryFile(`properties:
  title:
    displayName: Work
  tags:
    displayName: Keywords
views:
  - type: table
    name: Items
    from: items
`);
    const properties = viewProperties(file, file.views[0]!);
    const label = (path: string) => properties.entry(path).label;
    const sort = sortOptions("items", label);
    expect(sort.find((option) => option.path === "title")?.label).toBe("Work");
    expect(sort.find((option) => option.path === "date")?.label).toBe("Date");
    const group = groupOptions("items", label);
    expect(group.find((option) => option.path === "tags[]")?.label).toBe(
      "Keywords",
    );
  });
});
