import { describe, expect, it } from "vitest";

import {
  editView,
  NEW_QUERY_FILE_LIMIT,
  newQueryFileText,
  parseQueryFile,
  serializeQueryFile,
  viewFilter,
} from "./query-file";

const TWO_VIEWS = `filters: item.itemType == "journalArticle"
formulas:
  short: item.title.slice(0, 10)
properties:
  item.title:
    displayName: Title
summaries:
  colorName: Unique
views:
  - type: annotations
    name: All annotations
    from: annotations
    filters:
      and:
        - colorName == "yellow"
        - or:
            - tags.contains("figure")
            - comment != null
    sort:
      - property: item.dateModified
        direction: DESC
      - property: sortIndex
        direction: ASC
    groupBy:
      property: item.indexedKey
      direction: ASC
    limit: 50
    cardWidth: 300
  - type: annotations
    name: Figures
    from: annotations
custom: kept
`;

describe("parseQueryFile", () => {
  it("reads the views of a file in order, with their dataset, sort, grouping and limit", () => {
    const file = parseQueryFile(TWO_VIEWS);
    expect(file.problems).toEqual([]);
    expect(file.views.map((view) => view.name)).toEqual([
      "All annotations",
      "Figures",
    ]);
    const [first] = file.views;
    expect(first).toMatchObject({
      type: "annotations",
      from: "annotations",
      sort: [
        { property: "item.dateModified", direction: "DESC" },
        { property: "sortIndex", direction: "ASC" },
      ],
      groupBy: { property: "item.indexedKey", direction: "ASC" },
      limit: 50,
      problems: [],
    });
  });

  it("keeps formulas, summaries, properties and keys it does not know through a round trip", () => {
    const text = serializeQueryFile(parseQueryFile(TWO_VIEWS));
    expect(text).toBe(TWO_VIEWS);
  });

  it("opens a not group as one expression condition", () => {
    const file = parseQueryFile(`views:
  - type: annotations
    name: Not yellow
    from: annotations
    filters:
      and:
        - tags.contains("figure")
        - not:
            - colorName == "yellow"
            - comment == null
`);
    expect(file.views[0]!.filters).toEqual({
      and: [
        'tags.contains("figure")',
        '!((colorName == "yellow") || (comment == null))',
      ],
    });
  });

  it("opens a file whose view misses a required key and names the problem", () => {
    const file = parseQueryFile(`views:
  - type: annotations
    from: annotations
  - name: No layout
    from: notes
`);
    expect(file.views).toHaveLength(2);
    expect(file.views[0]!.problems).toEqual([
      { code: "missing-key", key: "name" },
    ]);
    expect(file.views[1]!.problems).toEqual([
      { code: "missing-key", key: "type" },
      { code: "invalid-value", key: "from", value: "notes" },
    ]);
  });

  it("opens text that is not YAML with a problem and no views", () => {
    const file = parseQueryFile("views: [unclosed");
    expect(file.views).toEqual([]);
    expect(file.problems).toEqual([
      expect.objectContaining({ code: "invalid-yaml" }),
    ]);
  });

  it("opens an empty file with a problem that it has no views", () => {
    expect(parseQueryFile("").problems).toEqual([{ code: "no-views" }]);
  });
});

describe("viewFilter", () => {
  it("joins the filters for all views and the view's own filters with and", () => {
    const file = parseQueryFile(TWO_VIEWS);
    expect(viewFilter(file, file.views[0]!)).toBe(
      '(item.itemType == "journalArticle") && ((colorName == "yellow") && ((tags.contains("figure")) || (comment != null)))',
    );
    expect(viewFilter(file, file.views[1]!)).toBe(
      'item.itemType == "journalArticle"',
    );
  });

  it("gives no filter when the file and the view have none", () => {
    const file = parseQueryFile(newQueryFileText("Annotations"));
    expect(viewFilter(file, file.views[0]!)).toBeUndefined();
  });
});

describe("newQueryFileText", () => {
  it("writes one Annotations view of the whole library, grouped by Item, with the default limit", () => {
    const file = parseQueryFile(newQueryFileText("Annotations"));
    expect(file.problems).toEqual([]);
    expect(file.views).toEqual([
      expect.objectContaining({
        type: "annotations",
        name: "Annotations",
        from: "annotations",
        groupBy: { property: "item.indexedKey", direction: "ASC" },
        limit: NEW_QUERY_FILE_LIMIT,
        problems: [],
      }),
    ]);
    expect(file.views[0]!.filters).toBeUndefined();
  });
});

const GROUPED = `views:
  - type: annotations
    name: Colours
    from: annotations
    groupBy:
      property: colorName
      direction: ASC
    groupOrder:
      - red
      - yellow
      - null
    cardWidth: 300
  - type: annotations
    name: Figures
    from: annotations
`;

describe("groupOrder", () => {
  it("reads a Manual group order, with the group of no value as null", () => {
    const file = parseQueryFile(GROUPED);
    expect(file.views[0]!.problems).toEqual([]);
    expect(file.views[0]!.groupOrder).toEqual(["red", "yellow", null]);
    expect(serializeQueryFile(file)).toBe(GROUPED);
  });

  it("names a groupOrder that is not a list as a problem", () => {
    const file = parseQueryFile(`views:
  - type: annotations
    name: Colours
    from: annotations
    groupOrder: red
`);
    expect(file.views[0]!.problems).toEqual([
      { code: "invalid-value", key: "groupOrder", value: "red" },
    ]);
  });
});

describe("editView", () => {
  it("writes a new sort in the view, and keeps every other key in its place", () => {
    const file = parseQueryFile(GROUPED);
    const next = editView(file, file.views[0]!, {
      sort: [
        { property: "dateAdded", direction: "DESC" },
        { property: "pageIndex", direction: "ASC" },
      ],
    });
    expect(serializeQueryFile(next)).toBe(`views:
  - type: annotations
    name: Colours
    from: annotations
    groupBy:
      property: colorName
      direction: ASC
    groupOrder:
      - red
      - yellow
      - null
    cardWidth: 300
    sort:
      - property: dateAdded
        direction: DESC
      - property: pageIndex
        direction: ASC
  - type: annotations
    name: Figures
    from: annotations
`);
  });

  it("drops the sort, the grouping and the group order it is told to clear", () => {
    const file = parseQueryFile(GROUPED);
    const next = editView(file, file.views[0]!, {
      groupBy: undefined,
      groupOrder: undefined,
    });
    expect(serializeQueryFile(next)).toBe(`views:
  - type: annotations
    name: Colours
    from: annotations
    cardWidth: 300
  - type: annotations
    name: Figures
    from: annotations
`);
  });

  it("drops the Manual group order when the grouping takes another property", () => {
    const file = parseQueryFile(GROUPED);
    const next = editView(file, file.views[0]!, {
      groupBy: { property: "tags[]", direction: "ASC" },
    });
    expect(next.views[0]!.groupOrder).toBeUndefined();
    expect(serializeQueryFile(next)).not.toContain("groupOrder");
  });

  it("keeps the Manual group order when only the direction changes", () => {
    const file = parseQueryFile(GROUPED);
    const next = editView(file, file.views[0]!, {
      groupBy: { property: "colorName", direction: "DESC" },
    });
    expect(next.views[0]!.groupOrder).toEqual(["red", "yellow", null]);
    expect(next.views[0]!.groupBy).toEqual({
      property: "colorName",
      direction: "DESC",
    });
  });
});
