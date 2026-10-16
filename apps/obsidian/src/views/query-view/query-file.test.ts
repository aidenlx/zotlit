import { describe, expect, it } from "vitest";

import {
  editView,
  NEW_QUERY_FILE_LIMIT,
  allViewsDataset,
  displayName,
  locateFilterFault,
  newQueryFileText,
  removeFormula,
  withDisplayName,
  withFilters,
  withFormula,
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

  it("keeps a not group", () => {
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
        { not: ['colorName == "yellow"', "comment == null"] },
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

  it("names two views of one name as a problem of the file", () => {
    const file = parseQueryFile(`views:
  - type: annotations
    name: Figures
  - type: list
    name: Figures
  - type: annotations
    name: Methods
`);
    expect(file.views).toHaveLength(3);
    expect(file.problems).toEqual([
      { code: "duplicate-view-name", name: "Figures" },
    ]);
  });

  it("opens an empty file with a problem that it has no views", () => {
    expect(parseQueryFile("").problems).toEqual([{ code: "no-views" }]);
  });
});

describe("editView: order and limit", () => {
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
      editView(file, file.views[0]!, {
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
    const updated = editView(file, file.views[0]!, {
      order: [],
      limit: undefined,
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
    const updated = editView(file, file.views[0]!, { order: ["comment"] });
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

  it("applies the filters for all views only to views of the first view's dataset", () => {
    const file = parseQueryFile(`filters: item.title.contains("Rules")
views:
  - type: annotations
    name: Annotations
    from: annotations
  - type: table
    name: Items
    from: items
    filters: title != null
`);
    expect(allViewsDataset(file)).toBe("annotations");
    expect(viewFilter(file, file.views[0]!)).toBe(
      'item.title.contains("Rules")',
    );
    expect(viewFilter(file, file.views[1]!)).toBe("title != null");
  });

  it("gives no filter when the file and the view have none", () => {
    const file = parseQueryFile(newQueryFileText("Annotations"));
    expect(viewFilter(file, file.views[0]!)).toBeUndefined();
  });
});

describe("locateFilterFault", () => {
  const file = parseQueryFile(TWO_VIEWS);
  const view = file.views[0]!;
  const text = viewFilter(file, view)!;
  const at = (needle: string) => {
    const from = text.indexOf(needle);
    return { from, to: from + needle.length };
  };

  it("finds the condition of the filters for all views that a fault marks", () => {
    expect(locateFilterFault(file, view, at("journalArticle"))).toEqual({
      section: "all",
      path: [0],
    });
  });

  it("finds a nested condition of the view's own filters", () => {
    expect(locateFilterFault(file, view, at("comment"))).toEqual({
      section: "view",
      path: [1, 1],
    });
    expect(locateFilterFault(file, view, at("colorName"))).toEqual({
      section: "view",
      path: [0],
    });
  });

  it("finds no condition for a fault between conditions", () => {
    expect(locateFilterFault(file, view, at(") && ("))).toBeNull();
  });
});

describe("withFilters", () => {
  it("writes the filters for all views and a view's filters to the file text, keeping the rest", () => {
    const file = parseQueryFile(TWO_VIEWS);
    const next = withFilters(
      withFilters(file, null, { and: ['tags.contains("x")'] }),
      1,
      { or: ['colorName == "red"', 'colorName == "blue"'] },
    );
    const text = serializeQueryFile(next);
    expect(text).toContain(
      'filters:\n  and:\n    - tags.contains("x")\nformulas:',
    );
    expect(text).toContain(`    name: Figures
    from: annotations
    filters:
      or:
        - colorName == "red"
        - colorName == "blue"`);
    expect(text).toContain("custom: kept");
  });

  it("drops the filters key when the researcher clears every condition", () => {
    const file = parseQueryFile(TWO_VIEWS);
    const text = serializeQueryFile(withFilters(file, 0, undefined));
    expect(parseQueryFile(text).views[0]!.filters).toBeUndefined();
    expect(text).toContain("cardWidth: 300");
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

describe("formulas", () => {
  const FORMULAS = `formulas:
  year: date.year
  short: title.slice(0, 10)
views:
  - type: table
    name: Items
    from: items
    order:
      - title
      - formula.year
      - formula.short
  - type: list
    name: Years
    from: items
    order:
      - formula.year
custom: kept
`;

  it("reads each Formula name with its expression text", () => {
    const file = parseQueryFile(FORMULAS);
    expect(file.problems).toEqual([]);
    expect(file.formulas).toEqual({
      year: "date.year",
      short: "title.slice(0, 10)",
    });
    expect(file.views[0]!.order).toEqual([
      "title",
      "formula.year",
      "formula.short",
    ]);
  });

  it("names a formulas key that is not a map of texts as a problem", () => {
    const file = parseQueryFile(`formulas:
  year: 2020
views:
  - type: list
    name: Items
    from: items
`);
    expect(file.formulas).toBeUndefined();
    expect(file.problems).toEqual([
      { code: "invalid-value", key: "formulas", value: { year: 2020 } },
    ]);
  });

  it("writes an edited Formula in place, and keeps the other keys", () => {
    const file = withFormula(parseQueryFile(FORMULAS), "year", "date.year + 1");
    expect(serializeQueryFile(file)).toBe(
      FORMULAS.replace("year: date.year", "year: date.year + 1"),
    );
  });

  it("adds a new Formula after the others, and a formulas key before the views of a file that had none", () => {
    expect(
      serializeQueryFile(
        withFormula(parseQueryFile(FORMULAS), "authors", "creators.length"),
      ),
    ).toBe(
      FORMULAS.replace(
        "  short: title.slice(0, 10)\n",
        "  short: title.slice(0, 10)\n  authors: creators.length\n",
      ),
    );
    expect(
      serializeQueryFile(
        withFormula(
          parseQueryFile(
            "views:\n  - type: list\n    name: Items\n    from: items\n",
          ),
          "year",
          "date.year",
        ),
      ),
    ).toBe(
      "formulas:\n  year: date.year\nviews:\n  - type: list\n    name: Items\n    from: items\n",
    );
  });

  it("removes a Formula from formulas and from the order of every view", () => {
    const file = removeFormula(parseQueryFile(FORMULAS), "year");
    expect(file.formulas).toEqual({ short: "title.slice(0, 10)" });
    expect(serializeQueryFile(file)).toBe(`formulas:
  short: title.slice(0, 10)
views:
  - type: table
    name: Items
    from: items
    order:
      - title
      - formula.short
  - type: list
    name: Years
    from: items
    order: []
custom: kept
`);
  });

  it("drops the formulas key when the last Formula goes", () => {
    const file = removeFormula(
      removeFormula(parseQueryFile(FORMULAS), "year"),
      "short",
    );
    expect(file.formulas).toBeUndefined();
    const text = serializeQueryFile(file);
    expect(text).not.toContain("formulas");
    expect(parseQueryFile(text).views[0]!.order).toEqual(["title"]);
  });
});

describe("display names", () => {
  const NAMED = `formulas:
  year: date.year
properties:
  title:
    displayName: Work
    width: 200
  formula.year:
    displayName: Year of source
  note.date:
    displayName: Note date
views:
  - type: table
    name: Items
    from: items
    order:
      - title
      - formula.year
custom: kept
`;

  it("reads the Display Name of each property by its order entry, and a note. prefix names nothing", () => {
    const file = parseQueryFile(NAMED);
    expect(file.problems).toEqual([]);
    expect(displayName(file, "title")).toBe("Work");
    expect(displayName(file, "formula.year")).toBe("Year of source");
    // A Bases-style note. prefix is not a Projection Path: it names no field.
    expect(displayName(file, "date")).toBeUndefined();
    expect(displayName(file, "item.title")).toBeUndefined();
  });

  it("names a properties key that is not a map as a problem", () => {
    const file = parseQueryFile(`properties: [title]
views:
  - type: list
    name: Items
    from: items
`);
    expect(displayName(file, "title")).toBeUndefined();
    expect(file.problems).toEqual([
      { code: "invalid-value", key: "properties", value: ["title"] },
    ]);
  });

  it("writes a changed Display Name in place, and keeps the keys it does not know", () => {
    const file = withDisplayName(parseQueryFile(NAMED), "title", "Source");
    expect(displayName(file, "title")).toBe("Source");
    expect(serializeQueryFile(file)).toBe(
      NAMED.replace("displayName: Work", "displayName: Source"),
    );
  });

  it("adds a Display Name after the others, and a properties key before the views of a file that had none", () => {
    expect(
      serializeQueryFile(
        withDisplayName(parseQueryFile(NAMED), "date", "Published"),
      ),
    ).toBe(
      NAMED.replace("views:", "  date:\n    displayName: Published\nviews:"),
    );
    expect(
      serializeQueryFile(
        withDisplayName(
          parseQueryFile(
            "views:\n  - type: list\n    name: Items\n    from: items\n",
          ),
          "title",
          "Work",
        ),
      ),
    ).toBe(
      "properties:\n  title:\n    displayName: Work\nviews:\n  - type: list\n    name: Items\n    from: items\n",
    );
  });

  it("removes a Display Name, its property entry when nothing else is left, and the properties key with the last one", () => {
    const cleared = withDisplayName(parseQueryFile(NAMED), "title", undefined);
    expect(displayName(cleared, "title")).toBeUndefined();
    expect(serializeQueryFile(cleared)).toBe(
      NAMED.replace("    displayName: Work\n", ""),
    );
    const single =
      "properties:\n  title:\n    displayName: Work\nviews:\n  - type: list\n    name: Items\n    from: items\n";
    expect(
      serializeQueryFile(
        withDisplayName(parseQueryFile(single), "title", undefined),
      ),
    ).toBe("views:\n  - type: list\n    name: Items\n    from: items\n");
  });

  it("leaves the file as it is when it removes a Display Name the property does not have", () => {
    const text = `properties:
  - title
views:
  - type: list
    name: Items
    from: items
`;
    expect(
      serializeQueryFile(
        withDisplayName(parseQueryFile(text), "formula.year", undefined),
      ),
    ).toBe(text);
    expect(
      serializeQueryFile(
        withDisplayName(parseQueryFile(NAMED), "date", undefined),
      ),
    ).toBe(NAMED);
  });

  it("removes the properties entry of a removed Formula", () => {
    const file = removeFormula(parseQueryFile(NAMED), "year");
    expect(displayName(file, "formula.year")).toBeUndefined();
    expect(serializeQueryFile(file)).toBe(
      NAMED.replace("formulas:\n  year: date.year\n", "")
        .replace("  formula.year:\n    displayName: Year of source\n", "")
        .replace("      - formula.year\n", ""),
    );
  });
});

describe("Formula names that are also object members", () => {
  it("adds, renames and removes a Formula named __proto__ like any other", () => {
    const file = parseQueryFile(`formulas:
  __proto__: date.year
views:
  - type: table
    name: Items
    from: items
    order:
      - formula.__proto__
`);
    expect(Object.entries(file.formulas ?? {})).toEqual([
      ["__proto__", "date.year"],
    ]);
    const added = withDisplayName(
      withFormula(file, "constructor", "title"),
      "formula.__proto__",
      "Year",
    );
    expect(displayName(added, "formula.__proto__")).toBe("Year");
    expect(serializeQueryFile(added)).toContain(
      "formulas:\n  __proto__: date.year\n  constructor: title\nproperties:\n  formula.__proto__:\n    displayName: Year\n",
    );
    const removed = removeFormula(added, "__proto__");
    expect(Object.entries(removed.formulas ?? {})).toEqual([
      ["constructor", "title"],
    ]);
    expect(removed.properties).toBeUndefined();
  });
});
