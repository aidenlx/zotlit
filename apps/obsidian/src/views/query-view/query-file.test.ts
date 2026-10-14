import { describe, expect, it } from "vitest";

import {
  NEW_QUERY_FILE_LIMIT,
  newQueryFileText,
  parseQueryFile,
  serializeQueryFile,
  updateView,
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

describe("updateView", () => {
  const ORDERED = `views:
  - type: annotations
    name: Shared
    from: annotations
    order:
      - item.title
      - comment
    limit: 20
    cardWidth: 300
`;

  it("reads the visible properties in their order", () => {
    expect(parseQueryFile(ORDERED).views[0]!.order).toEqual([
      "item.title",
      "comment",
    ]);
  });

  it("writes new visible properties and a new limit in place, and keeps the other keys", () => {
    const file = parseQueryFile(ORDERED);
    const text = serializeQueryFile(
      updateView(file, file.views[0]!, {
        order: ["comment", "pageLabel"],
        limit: 5,
      }),
    );
    expect(text).toBe(`views:
  - type: annotations
    name: Shared
    from: annotations
    order:
      - comment
      - pageLabel
    limit: 5
    cardWidth: 300
`);
  });

  it("removes the limit to show every result, and keeps an empty order", () => {
    const file = parseQueryFile(ORDERED);
    const updated = updateView(file, file.views[0]!, {
      order: [],
      limit: null,
    });
    expect(updated.views[0]).toMatchObject({ order: [] });
    expect(updated.views[0]!.limit).toBeUndefined();
    expect(serializeQueryFile(updated)).toBe(`views:
  - type: annotations
    name: Shared
    from: annotations
    order: []
    cardWidth: 300
`);
  });

  it("adds visible properties to a view that had none, after its other keys", () => {
    const file = parseQueryFile(newQueryFileText("Annotations"));
    const updated = updateView(file, file.views[0]!, { order: ["comment"] });
    expect(parseQueryFile(serializeQueryFile(updated)).views[0]).toMatchObject({
      order: ["comment"],
      limit: NEW_QUERY_FILE_LIMIT,
    });
  });

  it("names an order that is not a list of property names as a problem", () => {
    const file = parseQueryFile(`views:
  - type: annotations
    name: Bad
    from: annotations
    order: comment
`);
    expect(file.views[0]!.problems).toEqual([
      { code: "invalid-value", key: "order", value: "comment" },
    ]);
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
