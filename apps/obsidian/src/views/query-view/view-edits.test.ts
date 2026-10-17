import { describe, expect, it } from "vitest";

import { parseQueryFile, serializeQueryFile } from "./query-file";
import type { QueryFile } from "./query-file";
import {
  addView,
  deleteView,
  duplicateView,
  moveView,
  renameView,
  setViewDataset,
  setViewLayout,
  setViewOption,
  viewNameIssue,
} from "./view-edits";
import { unusedSettings } from "./view-properties";

const FILE = `views:
  - type: annotations
    name: All annotations
    from: annotations
    groupBy:
      property: item.indexedKey
      direction: ASC
    limit: 100
    custom: kept
  - type: annotations
    name: Figures
    from: annotations
    filters: tags.contains("figure")
  - type: annotations
    name: Yellow
    from: annotations
`;

/** The file as a save writes it and the next open reads it. */
function saved(file: QueryFile): QueryFile {
  return parseQueryFile(serializeQueryFile(file));
}

function names(file: QueryFile): string[] {
  return file.views.map((view) => view.name);
}

describe("view edits", () => {
  it("adds a view at the end with a free name, reading annotations with a limit", () => {
    const first = addView(parseQueryFile(FILE), "View");
    expect(first.name).toBe("View");
    const second = addView(saved(first.file), "View");
    expect(second.name).toBe("View 2");
    const file = saved(second.file);
    expect(names(file)).toEqual([
      "All annotations",
      "Figures",
      "Yellow",
      "View",
      "View 2",
    ]);
    expect(file.views[4]).toMatchObject({
      type: "annotations",
      from: "annotations",
      limit: 100,
      problems: [],
    });
  });

  it("renames a view and keeps the rest of its keys", () => {
    const file = saved(renameView(parseQueryFile(FILE), 0, "Everything"));
    expect(names(file)).toEqual(["Everything", "Figures", "Yellow"]);
    expect(file.views[0]).toMatchObject({
      groupBy: { property: "item.indexedKey", direction: "ASC" },
      limit: 100,
    });
    expect(file.views[0]!.source.custom).toBe("kept");
  });

  it("duplicates a view after itself under a free name, with its filters", () => {
    const { file, name } = duplicateView(parseQueryFile(FILE), 1);
    expect(name).toBe("Figures 2");
    const read = saved(file);
    expect(names(read)).toEqual([
      "All annotations",
      "Figures",
      "Figures 2",
      "Yellow",
    ]);
    expect(read.views[2]!.filters).toBe('tags.contains("figure")');
  });

  it("deletes a view and names the view before it to show next", () => {
    const middle = deleteView(parseQueryFile(FILE), 1);
    expect(names(saved(middle.file))).toEqual(["All annotations", "Yellow"]);
    expect(middle.name).toBe("All annotations");
    const first = deleteView(parseQueryFile(FILE), 0);
    expect(first.name).toBe("Figures");
  });

  it("moves a view, and the default view is the first", () => {
    const file = parseQueryFile(FILE);
    expect(names(saved(moveView(file, 2, 0)))).toEqual([
      "Yellow",
      "All annotations",
      "Figures",
    ]);
    expect(names(saved(moveView(file, 0, 2)))).toEqual([
      "Figures",
      "Yellow",
      "All annotations",
    ]);
  });

  it("writes a layout option into the view, and removes it again", () => {
    const set = saved(
      setViewOption(parseQueryFile(FILE), 1, { key: "cardWidth", value: 420 }),
    );
    expect(set.views[1]!.source.cardWidth).toBe(420);
    expect(serializeQueryFile(set)).toContain("cardWidth: 420");
    const removed = saved(
      setViewOption(set, 1, { key: "cardWidth", value: undefined }),
    );
    expect(removed.views[1]!.source).not.toHaveProperty("cardWidth");
  });

  it("sets the layout of a view", () => {
    const file = saved(setViewLayout(parseQueryFile(FILE), 2, "table"));
    expect(file.views[2]!.type).toBe("table");
  });

  it("switches a view to Items: the Table draws it, and its filters, sort, grouping and properties stay in the file", () => {
    const file = setViewDataset(
      parseQueryFile(`views:
  - type: annotations
    name: Figures
    from: annotations
    filters: tags.contains("figure")
    sort:
      - property: pageIndex
        direction: ASC
      - property: dateAdded
        direction: DESC
    groupBy:
      property: item.indexedKey
      direction: ASC
    groupOrder:
      - RUGIER24
    order:
      - comment
      - dateAdded
    limit: 100
`),
      0,
      "items",
    );
    const view = saved(file).views[0]!;
    expect(view).toMatchObject({
      type: "table",
      from: "items",
      filters: 'tags.contains("figure")',
      sort: [
        { property: "pageIndex", direction: "ASC" },
        { property: "dateAdded", direction: "DESC" },
      ],
      groupBy: { property: "item.indexedKey", direction: "ASC" },
      groupOrder: ["RUGIER24"],
      order: ["comment", "dateAdded"],
      limit: 100,
    });
    // Items have no page, no grouping by Item and no comment: the view does
    // not use them while it shows Items.
    expect(unusedSettings(view)).toEqual({
      sort: ["pageIndex"],
      groupBy: "item.indexedKey",
      order: ["comment"],
    });
    // Back on Annotations, the view uses each of them again.
    const back = saved(setViewDataset(file, 0, "annotations")).views[0]!;
    expect(back.type).toBe("annotations");
    expect(unusedSettings(back)).toEqual({
      sort: [],
      groupBy: null,
      order: [],
    });
  });

  it("keeps the layout of a view that can show the new dataset", () => {
    const file = setViewDataset(
      parseQueryFile(
        "views:\n  - type: list\n    name: Sources\n    from: items\n",
      ),
      0,
      "attachments",
    );
    expect(saved(file).views[0]).toMatchObject({
      type: "list",
      from: "attachments",
    });
  });

  it("uses a property that no dataset lists, such as one the researcher typed", () => {
    const [view] = parseQueryFile(
      'views:\n  - type: table\n    name: Sources\n    from: items\n    order:\n      - custom["Reading status"]\n',
    ).views;
    expect(unusedSettings(view!).order).toEqual([]);
  });

  it("adds a view of the dataset it is given, drawn by the first layout of that dataset", () => {
    const edit = addView(parseQueryFile(FILE), "View", "items");
    expect(saved(edit.file).views.at(-1)).toMatchObject({
      name: "View",
      type: "table",
      from: "items",
    });
  });

  it("says why a view name cannot stand", () => {
    const file = parseQueryFile(FILE);
    expect(viewNameIssue(file, 0, "  ")).toBe("empty");
    expect(viewNameIssue(file, 0, "Figures")).toBe("taken");
    expect(viewNameIssue(file, 1, "Figures")).toBeNull();
    expect(viewNameIssue(file, 0, "Figures #1")).toBe("invalid");
    expect(viewNameIssue(file, 0, "A | B")).toBe("invalid");
    expect(viewNameIssue(file, 0, "Methods")).toBeNull();
  });
});

describe("a vault property in the file", () => {
  it("keeps its place in order, its Display Name and its column width through a save", () => {
    const file = parseQueryFile(`properties:
  vault.reading-status:
    displayName: Status
views:
  - type: table
    name: Reading list
    from: items
    order:
      - title
      - vault.reading-status
    columnSize:
      vault.reading-status: 140
`);
    const edited = setViewOption(file, 0, { key: "cardSize", value: 240 });
    const view = saved(edited).views[0]!;

    expect(view.order).toEqual(["title", "vault.reading-status"]);
    expect(view.columnSize).toEqual({ "vault.reading-status": 140 });
    expect(saved(edited).properties).toEqual({
      "vault.reading-status": { displayName: "Status" },
    });
  });
});
