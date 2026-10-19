// The Library View Document: how plugin data reads back, how each change
// takes it, and the Query View's text it becomes. The derivation tests read
// the text back as the Query View does, and ask the engine what its filter
// selects.
import { describe, expect, it } from "vitest";

import {
  ITEMS,
  planItemFilter,
  planPath,
  testItemSeed,
} from "@zotlit/item-query";
import type { QueryItemSeed } from "@zotlit/item-query";

import type { LibrarySelector } from "@/services/library-scope/scope";
import {
  parseQueryFile,
  serializeQueryFile,
} from "@/views/query-view/query-file";
import type { QueryFile, QueryFileView } from "@/views/query-view/query-file";
import { splitFilters } from "@/views/query-view/view-plan/filter-split";

import {
  CARD_WIDTH_MIN,
  cardWidthBounds,
  clampCardWidth,
  DEFAULT_LIBRARY_VIEW_DOCUMENT,
  libraryViewQuery,
  libraryViewQueryFileLeftOut,
  libraryViewQueryFileText,
  parseLibraryViewDocument,
  serializeLibraryViewDocument,
  tagListRequest,
  tagNames,
  pruneExpanded,
  withCardClosed,
  withCardWidth,
  withExpanded,
  withNode,
  withSelected,
  withTags,
  withText,
} from "./document";
import type { LibraryNode, LibraryViewDocument } from "./document";
import { searchTerms } from "./search";

/** The filter ZotLit Query runs for a view that holds no vault condition. */
const viewFilter = (file: QueryFile, view: QueryFileView) =>
  splitFilters(file, view).engine(null)?.text;

/** A document with a value other than the default in every field. */
const CHAPTER: LibraryViewDocument = {
  node: {
    kind: "collection",
    library: { type: "group", groupID: 4200309 },
    path: ["Thesis", "Chapter 2"],
  },
  facets: ["annotated", "pdf"],
  tags: ["figure", "read-later"],
  search: "attention tag:method",
  sort: [
    { property: "title", direction: "ASC" },
    { property: "dateAdded", direction: "DESC" },
  ],
  card: { allFields: true, annotations: true },
  expanded: [
    JSON.stringify(["group:4200309", "Thesis"]),
    `closed:${JSON.stringify(["personal"])}`,
  ],
  selected: "4200309:ABCD2345",
};

describe("parseLibraryViewDocument and serializeLibraryViewDocument", () => {
  it("round-trips every field", () => {
    const stored = serializeLibraryViewDocument(CHAPTER);
    expect(parseLibraryViewDocument(stored)).toEqual(CHAPTER);
    expect(
      serializeLibraryViewDocument(parseLibraryViewDocument(stored)),
    ).toEqual(stored);
  });

  it("stores the document as JSON data, which plugin data holds", () => {
    const stored = serializeLibraryViewDocument(CHAPTER);
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
  });

  it("round-trips a library node", () => {
    const doc: LibraryViewDocument = {
      ...DEFAULT_LIBRARY_VIEW_DOCUMENT,
      node: { kind: "library", library: { type: "group", groupID: 118 } },
    };
    expect(
      parseLibraryViewDocument(serializeLibraryViewDocument(doc)).node,
    ).toEqual({ kind: "library", library: { type: "group", groupID: 118 } });
  });

  it("round-trips Recent, which names no Library", () => {
    const doc: LibraryViewDocument = {
      ...CHAPTER,
      node: { kind: "recent" },
    };
    expect(
      parseLibraryViewDocument(serializeLibraryViewDocument(doc)).node,
    ).toEqual({ kind: "recent" });
  });

  it("keeps a Collection name that holds a slash as one name of the path", () => {
    const doc: LibraryViewDocument = {
      ...DEFAULT_LIBRARY_VIEW_DOCUMENT,
      node: {
        kind: "collection",
        library: { type: "personal" },
        path: ["Reading", "2024/25"],
      },
    };
    expect(
      parseLibraryViewDocument(serializeLibraryViewDocument(doc)).node,
    ).toEqual(doc.node);
  });

  it("opens on Recent as Papers, newest first, when plugin data holds no document", () => {
    expect(parseLibraryViewDocument(null)).toEqual({
      node: { kind: "recent" },
      facets: [],
      tags: [],
      search: "",
      sort: [{ property: "lastActivity", direction: "DESC" }],
      // The Reading Card opens with All fields and Annotations closed.
      card: { allFields: false, annotations: false },
      // No Collection open, and no paper selected.
      expanded: [],
      selected: null,
    });
  });

  it("reads the open tree nodes each once, and drops what is not a key", () => {
    const thesis = JSON.stringify(["personal", "Reading"]);
    expect(
      parseLibraryViewDocument({ expanded: [thesis, "", 3, thesis, null] })
        .expanded,
    ).toEqual([thesis]);
  });

  it("opens the Collections above the selected node on read, beside the nodes left open", () => {
    const thesis = JSON.stringify(["personal", "Thesis"]);
    const chapter = JSON.stringify(["personal", "Thesis", "Chapter 2"]);
    const other = JSON.stringify(["personal", "Reading"]);
    expect(
      parseLibraryViewDocument({
        node: {
          kind: "collection",
          library: { type: "personal" },
          path: ["Thesis", "Chapter 2", "Figures"],
        },
        expanded: [other],
      }).expanded,
    ).toEqual([other, thesis, chapter]);
  });

  it("takes no selected paper and no open node where either cannot be read, and keeps the rest", () => {
    const stored = serializeLibraryViewDocument(CHAPTER);
    expect(parseLibraryViewDocument({ ...stored, selected: 42 })).toEqual({
      ...CHAPTER,
      selected: null,
    });
    expect(parseLibraryViewDocument({ ...stored, selected: "" })).toEqual({
      ...CHAPTER,
      selected: null,
    });
    expect(parseLibraryViewDocument({ ...stored, expanded: "Thesis" })).toEqual(
      {
        ...CHAPTER,
        // The Collection above the selected one still opens.
        expanded: [JSON.stringify(["group:4200309", "Thesis"])],
      },
    );
  });

  it("reads a document an earlier build stored, with no open nodes and no selected paper", () => {
    const {
      expanded: _expanded,
      selected: _selected,
      ...earlier
    } = serializeLibraryViewDocument(CHAPTER);
    expect(parseLibraryViewDocument(earlier)).toEqual({
      ...CHAPTER,
      expanded: [JSON.stringify(["group:4200309", "Thesis"])],
      selected: null,
    });
  });

  it("keeps a Reading Card disclosure it reads where the other does not read", () => {
    expect(
      parseLibraryViewDocument({
        card: { allFields: true, annotations: "yes" },
      }).card,
    ).toEqual({ allFields: true, annotations: false });
    expect(parseLibraryViewDocument({ card: "open" }).card).toEqual({
      allFields: false,
      annotations: false,
    });
  });

  it("reads a document an earlier build stored, with no tags, as one with none selected", () => {
    const { tags: _, ...earlier } = serializeLibraryViewDocument(CHAPTER);
    expect(parseLibraryViewDocument(earlier)).toEqual({ ...CHAPTER, tags: [] });
  });

  it("reads each tag once, by name, and drops what is not a tag name", () => {
    expect(
      parseLibraryViewDocument({
        tags: ["read-later", "", 7, "Data", "read-later", "figure"],
      }).tags,
    ).toEqual(["Data", "figure", "read-later"]);
  });

  it("takes the default for each field it cannot read, keeps the others and drops a facet it does not know", () => {
    const parsed = parseLibraryViewDocument({
      node: { kind: "collection", library: { type: "personal" }, path: [] },
      facets: ["annotated", "starred"],
      search: 42,
      sort: [{ property: "title", direction: "sideways" }],
    });
    expect(parsed).toEqual({
      ...DEFAULT_LIBRARY_VIEW_DOCUMENT,
      facets: ["annotated"],
    });
  });

  it("ignores the Layout and the Visible Properties an earlier build stored, and keeps the rest", () => {
    const parsed = parseLibraryViewDocument({
      ...serializeLibraryViewDocument(CHAPTER),
      layout: "table",
      order: ["title", "firstAuthor"],
    });
    expect(parsed).toEqual(CHAPTER);
    expect(serializeLibraryViewDocument(parsed)).not.toHaveProperty("layout");
    expect(serializeLibraryViewDocument(parsed)).not.toHaveProperty("order");
  });

  it("reads each facet once, in the order the tree shows them", () => {
    expect(
      parseLibraryViewDocument({
        facets: ["pdf", "unread", "pdf", "has-note"],
      }).facets,
    ).toEqual(["unread", "has-note", "pdf"]);
  });
});

describe("withTags", () => {
  it("selects the tags by name, each once, and keeps the rest", () => {
    expect(withTags(CHAPTER, ["talk", "figure", "talk"])).toEqual({
      ...CHAPTER,
      tags: ["figure", "talk"],
    });
  });

  it("keeps the selected tags when another node is selected", () => {
    expect(withNode(CHAPTER, { kind: "recent" }).tags).toEqual([
      "figure",
      "read-later",
    ]);
  });
});

describe("withNode", () => {
  it("selects a Library or a Collection and keeps the sort, with no paper selected", () => {
    const node = { kind: "library", library: { type: "personal" } } as const;
    expect(withNode(CHAPTER, node)).toEqual({
      ...CHAPTER,
      node,
      selected: null,
    });
  });

  it("selects Recent with its sort, newest activity first, and keeps the rest", () => {
    expect(withNode(CHAPTER, { kind: "recent" })).toEqual({
      ...CHAPTER,
      node: { kind: "recent" },
      sort: [{ property: "lastActivity", direction: "DESC" }],
      selected: null,
    });
  });

  it("leaves Recent for a Collection with no sort where the sort is still Recent's own", () => {
    const recent = withNode(CHAPTER, { kind: "recent" });
    expect(withNode(recent, CHAPTER.node)).toEqual({
      ...CHAPTER,
      sort: [],
      selected: null,
    });
  });

  it("leaves Recent with the sort the researcher set there", () => {
    const sort = [{ property: "title", direction: "ASC" }] as const;
    const recent = { ...CHAPTER, node: { kind: "recent" }, sort } as const;
    expect(withNode(recent, MY_LIBRARY)).toEqual({
      ...CHAPTER,
      node: MY_LIBRARY,
      sort,
      selected: null,
    });
  });

  it("keeps a newest-change-first sort that the researcher set on a Collection", () => {
    const sort = [{ property: "dateModified", direction: "DESC" }] as const;
    expect(withNode({ ...CHAPTER, sort }, MY_LIBRARY)).toEqual({
      ...CHAPTER,
      node: MY_LIBRARY,
      sort,
      selected: null,
    });
  });

  it("opens the Collections above the node it selects, and keeps the nodes left open", () => {
    const figures: LibraryNode = {
      kind: "collection",
      library: { type: "personal" },
      path: ["Thesis", "Chapter 2", "Figures"],
    };
    expect(withNode(CHAPTER, figures).expanded).toEqual([
      ...CHAPTER.expanded,
      JSON.stringify(["personal", "Thesis"]),
      JSON.stringify(["personal", "Thesis", "Chapter 2"]),
    ]);
  });
});

describe("withExpanded, withSelected and pruneExpanded", () => {
  const reading = JSON.stringify(["personal", "Reading"]);
  const gone = JSON.stringify(["personal", "Gone"]);

  it("keeps the tree nodes left open, each once, and the rest", () => {
    expect(withExpanded(CHAPTER, [reading, reading])).toEqual({
      ...CHAPTER,
      expanded: [reading],
    });
  });

  it("selects a paper, and lets go of it", () => {
    const selected = withSelected(CHAPTER, "1:QRST6789");
    expect(selected).toEqual({ ...CHAPTER, selected: "1:QRST6789" });
    expect(withSelected(selected, null)).toEqual({
      ...CHAPTER,
      selected: null,
    });
  });

  it("drops the open nodes the tree does not know, and leaves the document as it was where it knows them all", () => {
    const doc = withExpanded(CHAPTER, [reading, gone]);
    expect(pruneExpanded(doc, (key) => key !== gone)).toEqual({
      ...CHAPTER,
      expanded: [reading],
    });
    expect(pruneExpanded(CHAPTER, () => true)).toBe(CHAPTER);
  });
});

describe("the Reading Card's width", () => {
  it("round-trips a width the researcher set, and stores none for the default", () => {
    const wide = withCardWidth(CHAPTER, 480);
    expect(wide).toEqual({ ...CHAPTER, cardWidth: 480 });
    expect(
      parseLibraryViewDocument(serializeLibraryViewDocument(wide)),
    ).toEqual(wide);
    expect(serializeLibraryViewDocument(CHAPTER)).not.toHaveProperty(
      "cardWidth",
    );
    expect(
      parseLibraryViewDocument(serializeLibraryViewDocument(CHAPTER)),
    ).not.toHaveProperty("cardWidth");
  });

  it("drops a width that is not a finite number, and keeps the rest", () => {
    const stored = serializeLibraryViewDocument(CHAPTER);
    for (const cardWidth of ["480", null, Number.NaN, Infinity, -Infinity, {}])
      expect(parseLibraryViewDocument({ ...stored, cardWidth })).toEqual(
        CHAPTER,
      );
  });

  it("takes the minimum for a width below it, and whole pixels", () => {
    const stored = serializeLibraryViewDocument(CHAPTER);
    expect(
      parseLibraryViewDocument({ ...stored, cardWidth: 12 }).cardWidth,
    ).toBe(CARD_WIDTH_MIN);
    expect(
      parseLibraryViewDocument({ ...stored, cardWidth: -400 }).cardWidth,
    ).toBe(CARD_WIDTH_MIN);
    expect(
      parseLibraryViewDocument({ ...stored, cardWidth: 400.6 }).cardWidth,
    ).toBe(401);
  });

  it("returns to the default when the width is reset", () => {
    expect(withCardWidth(withCardWidth(CHAPTER, 480), undefined)).toEqual(
      CHAPTER,
    );
  });

  it("keeps the list 20rem beside the card, and the card 18rem, the floor winning on a narrow pane", () => {
    expect(cardWidthBounds(1200)).toEqual({ min: 288, max: 880 });
    expect(clampCardWidth(2000, 1200)).toBe(880);
    expect(clampCardWidth(100, 1200)).toBe(288);
    expect(clampCardWidth(500, 1200)).toBe(500);
    // Below 608px of pane there is no room for both: the card keeps 18rem.
    expect(cardWidthBounds(500)).toEqual({ min: 288, max: 288 });
    expect(clampCardWidth(400, 500)).toBe(288);
    expect(clampCardWidth(5000)).toBe(5000);
  });

  it("takes at most 85% of a narrow pane the card shows over, and keeps 18rem where that fits", () => {
    // The card overlays the whole 740px pane, tree and list, so the list's
    // 20rem does not count.
    expect(cardWidthBounds(740, { overlay: true })).toEqual({
      min: 288,
      max: 629,
    });
    expect(clampCardWidth(500, 740, { overlay: true })).toBe(500);
    expect(clampCardWidth(2000, 740, { overlay: true })).toBe(629);
    expect(clampCardWidth(100, 740, { overlay: true })).toBe(288);
    // On a tiny pane the floor gives way to the cap.
    expect(cardWidthBounds(300, { overlay: true })).toEqual({
      min: 255,
      max: 255,
    });
    expect(clampCardWidth(400, 300, { overlay: true })).toBe(255);
  });
});

describe("the Reading Card closed", () => {
  it("round-trips a closed card, and stores nothing for an open one", () => {
    const closed = withCardClosed(withCardWidth(CHAPTER, 480), true);
    expect(closed).toEqual({ ...CHAPTER, cardWidth: 480, cardClosed: true });
    expect(serializeLibraryViewDocument(closed)).toMatchObject({
      cardClosed: true,
      cardWidth: 480,
    });
    expect(
      parseLibraryViewDocument(serializeLibraryViewDocument(closed)),
    ).toEqual(closed);
    expect(serializeLibraryViewDocument(CHAPTER)).not.toHaveProperty(
      "cardClosed",
    );
  });

  it("opens it again without the field, and keeps the width", () => {
    const closed = withCardClosed(withCardWidth(CHAPTER, 480), true);
    expect(withCardClosed(closed, false)).toEqual({
      ...CHAPTER,
      cardWidth: 480,
    });
    expect(withCardClosed(closed, false)).not.toHaveProperty("cardClosed");
  });

  it("reads the card open unless the field is true, and keeps the rest", () => {
    const stored = serializeLibraryViewDocument(CHAPTER);
    for (const cardClosed of [false, "true", 1, null, {}, undefined])
      expect(parseLibraryViewDocument({ ...stored, cardClosed })).toEqual(
        CHAPTER,
      );
    expect(parseLibraryViewDocument({ ...stored, cardClosed: true })).toEqual({
      ...CHAPTER,
      cardClosed: true,
    });
  });
});

const LABELS = {
  papers: "Papers",
};
/** The Library Scope in force: My Library and one group. */
const SCOPE = {
  mode: "selected",
  libraries: [{ type: "personal" }, { type: "group", groupID: 118 }],
} as const;
const MY_LIBRARY = {
  kind: "library",
  library: { type: "personal" },
} as const;

/** An Item of My Library, in the Collections at `paths`, with the tags `tags`. */
function seed(
  key: string,
  paths: string[][] = [],
  tags: string[] = [],
): QueryItemSeed {
  return {
    scan: {
      itemID: 1,
      key,
      itemType: "journalArticle",
      dateAdded: null,
      dateModified: null,
    },
    groupID: null,
    fields: { title: "A paper" },
    custom: {},
    customFieldNames: [],
    creators: [],
    tags: tags.map((name) => ({ name, type: 0 })),
    collections: paths,
  };
}

function derive(
  doc: Partial<LibraryViewDocument>,
  keys?: readonly string[],
  everywhere?: readonly LibrarySelector[],
) {
  const query = libraryViewQuery(
    { ...DEFAULT_LIBRARY_VIEW_DOCUMENT, node: MY_LIBRARY, ...doc },
    {
      labels: LABELS,
      scope: SCOPE,
      ...(keys && { keys }),
      ...(everywhere && { everywhere }),
    },
  );
  const file = parseQueryFile(query.text);
  expect(file.problems).toEqual([]);
  expect(file.views).toHaveLength(1);
  const view = file.views[0]!;
  expect(view.problems).toEqual([]);
  return { query, file, view, filter: viewFilter(file, view) };
}

/** Whether the filter selects the Item of `item`, as a query would. */
function selects(filter: string | undefined, item: QueryItemSeed): boolean {
  if (filter === undefined) return true;
  const answer = testItemSeed(filter, item);
  if (answer.kind !== "result") throw new Error(JSON.stringify(answer));
  return answer.matched;
}

/** Whether the filter plans for the Items dataset without a mistake. */
function plans(filter: string | undefined): boolean {
  return filter !== undefined && "matches" in planItemFilter(filter);
}

describe("libraryViewQuery — the rows", () => {
  it("shows at most a thousand rows, so a large library opens at once", () => {
    expect(derive({}).view.limit).toBe(1000);
  });

  it("names no Properties, as the Query View labels Creators and Year itself", () => {
    expect(derive({}).file.properties).toBeUndefined();
  });
});

describe("libraryViewQuery — the tree node", () => {
  it("names the node it lists, and none while a search reads every Library past it, Recent aside", () => {
    const thesis: LibraryNode = {
      kind: "collection",
      library: { type: "personal" },
      path: ["Thesis"],
    };
    const all = [
      { type: "personal" },
      { type: "group", groupID: 118 },
    ] as const;
    expect(derive({ node: thesis }).query.node).toEqual(thesis);
    expect(derive({ node: thesis }, ["ABCD2345"], all).query.node).toBeNull();
    // Recent reads every Library of the Library Scope already.
    expect(
      derive({ node: { kind: "recent" } }, ["ABCD2345"], all).query.node,
    ).toEqual({ kind: "recent" });
  });

  it("reads a Library as the query's library, with no filter", () => {
    const { query, filter } = derive({
      node: { kind: "library", library: { type: "group", groupID: 118 } },
    });
    expect(query.libraries).toEqual({
      mode: "selected",
      libraries: [{ type: "group", groupID: 118 }],
    });
    expect(filter).toBeUndefined();
  });

  it("reads a Collection as its Library and a collections.within filter for all views", () => {
    const { query, file, filter } = derive({
      node: {
        kind: "collection",
        library: { type: "personal" },
        path: ["Thesis", "Chapter 2"],
      },
    });
    expect(query.libraries).toEqual({
      mode: "selected",
      libraries: [{ type: "personal" }],
    });
    expect(file.filters).toBe('collections.within("Thesis/Chapter 2")');
    expect(selects(filter, seed("ABCD2345", [["Thesis", "Chapter 2"]]))).toBe(
      true,
    );
    expect(
      selects(filter, seed("ABCD2345", [["Thesis", "Chapter 2", "Figures"]])),
    ).toBe(true);
    expect(selects(filter, seed("ABCD2345", [["Thesis"]]))).toBe(false);
    expect(selects(filter, seed("ABCD2345", [["Thesis", "Chapter 20"]]))).toBe(
      false,
    );
  });
});

describe("libraryViewQuery — Recent", () => {
  const recent = () => derive({ node: { kind: "recent" } });

  it("reads every Library in the Library Scope, with no filter", () => {
    const { query, filter } = recent();
    expect(query.libraries).toEqual(SCOPE);
    expect(filter).toBeUndefined();
  });

  it("keeps the facets as filters", () => {
    const { file } = derive({
      node: { kind: "recent" },
      facets: ["annotated"],
    });
    expect(file.filters).toBe("annotations.length > 0");
  });
});

describe("libraryViewQuery — the Reading State facets", () => {
  it("reads Annotated as an Item with an Annotation", () => {
    const { query, file, filter } = derive({ facets: ["annotated"] });
    expect(file.filters).toBe("annotations.length > 0");
    expect(plans(filter)).toBe(true);
    expect(query.vault).toEqual([]);
  });

  it("reads PDF as an Item with a PDF file on this device", () => {
    const { query, file, filter } = derive({ facets: ["pdf"] });
    expect(file.filters).toBe(
      'attachments.filter(value.fileType == "pdf" && value.exists).length > 0',
    );
    expect(plans(filter)).toBe(true);
    expect(query.vault).toEqual([]);
  });

  it("reads Has note as a pass over the rows in the vault, with no filter", () => {
    const { query, filter } = derive({ facets: ["has-note"] });
    expect(filter).toBeUndefined();
    expect(query.vault).toEqual(["has-literature-note"]);
  });

  it("reads Unread as an Item with no Zotero read, Annotation, or Literature Note", () => {
    const { query, file, filter } = derive({ facets: ["unread"] });
    expect(file.filters).toBe("annotations.isEmpty() && lastRead == null");
    expect(plans(filter)).toBe(true);
    expect(query.vault).toEqual(["no-literature-note"]);
  });

  it("joins the facets and the Collection with and", () => {
    const { file, filter } = derive({
      node: {
        kind: "collection",
        library: { type: "personal" },
        path: ["Thesis"],
      },
      facets: ["annotated", "pdf"],
    });
    expect(file.filters).toEqual({
      and: [
        'collections.within("Thesis")',
        "annotations.length > 0",
        'attachments.filter(value.fileType == "pdf" && value.exists).length > 0',
      ],
    });
    expect(plans(filter)).toBe(true);
  });
});

describe("libraryViewQuery — the selected tags", () => {
  it("lists the Items with every selected tag, inside the Collection and beside the facets", () => {
    const { file, filter } = derive({
      node: {
        kind: "collection",
        library: { type: "personal" },
        path: ["Thesis"],
      },
      facets: ["annotated"],
      tags: ["figure", "to read"],
    });
    expect(file.filters).toEqual({
      and: [
        'collections.within("Thesis")',
        "annotations.length > 0",
        'tags.contains("figure")',
        'tags.contains("to read")',
      ],
    });
    expect(plans(filter)).toBe(true);
  });

  it("selects an Item that has both tags, and not one with only one of them", () => {
    const { filter } = derive({ tags: ["figure", "to read"] });
    expect(selects(filter, seed("ABCD2345", [], ["to read", "figure"]))).toBe(
      true,
    );
    expect(selects(filter, seed("WXYZ6789", [], ["figure"]))).toBe(false);
    expect(selects(filter, seed("QRST2345", [], ["to", "read"]))).toBe(false);
  });

  it("narrows Recent too, over every Library in the Library Scope", () => {
    const { query, file } = derive({
      node: { kind: "recent" },
      tags: ["talk"],
    });
    expect(query.libraries).toEqual(SCOPE);
    expect(file.filters).toBe('tags.contains("talk")');
  });
});

describe("tagListRequest and tagNames — the Tag Selector", () => {
  it("groups the Items of the selected Collection by tag, as the paper count reads them, with no facet or search", () => {
    const request = tagListRequest(
      {
        kind: "collection",
        library: { type: "personal" },
        path: ["Thesis"],
      },
      [],
      SCOPE,
    );
    expect(request).toMatchObject({
      from: "items",
      fields: [],
      group: "tags[].name",
      libraries: { mode: "selected", libraries: [{ type: "personal" }] },
    });
    expect(request.filter).toBe('collections.within("Thesis")');
    // The engine groups by one value of each tag: its name, a string.
    expect(planPath(request.group!, ITEMS.resolvePath)).toMatchObject({
      each: 1,
      shape: { kind: "scalar", type: "string" },
    });
  });

  it("reads every Library in the Library Scope on Recent, with no filter", () => {
    const request = tagListRequest({ kind: "recent" }, [], SCOPE);
    expect(request.libraries).toEqual(SCOPE);
    expect(request.filter).toBeUndefined();
  });

  it("asks only for the Items with every selected tag while tags are selected", () => {
    const { filter } = tagListRequest(MY_LIBRARY, ["figure", "talk"], SCOPE);
    expect(selects(filter, seed("ABCD2345", [], ["talk", "figure", "x"]))).toBe(
      true,
    );
    expect(selects(filter, seed("WXYZ6789", [], ["figure"]))).toBe(false);
    expect(plans(filter)).toBe(true);
  });

  it("names each tag once, by name, without the Items that have none", () => {
    expect(
      tagNames(
        [
          { value: "read-later" },
          { value: null },
          { value: "Data" },
          { value: "figure" },
        ],
        [],
      ),
    ).toEqual(["Data", "figure", "read-later"]);
  });

  it("always names a selected tag, even where no Item listed has it", () => {
    expect(tagNames([{ value: "figure" }], ["talk", "figure"])).toEqual([
      "figure",
      "talk",
    ]);
    expect(tagNames(null, ["talk"])).toEqual(["talk"]);
  });
});

describe("libraryViewQuery — search", () => {
  it("reads the ranked keys of a search as the Items the view shows, in rank order", () => {
    const { query, filter } = derive({ search: "attention" }, [
      "WXYZ6789",
      "ABCD2345",
    ]);
    expect(selects(filter, seed("ABCD2345"))).toBe(true);
    expect(selects(filter, seed("WXYZ6789"))).toBe(true);
    expect(selects(filter, seed("QRST2345"))).toBe(false);
    expect(query.rank).toEqual(["WXYZ6789", "ABCD2345"]);
  });

  it("shows no Item for a search that found none", () => {
    const { query, filter } = derive({ search: "zzz" }, []);
    expect(selects(filter, seed("ABCD2345"))).toBe(false);
    expect(query.rank).toEqual([]);
  });

  it("keeps the search inside the selected Collection", () => {
    const { filter } = derive(
      {
        node: {
          kind: "collection",
          library: { type: "personal" },
          path: ["Thesis"],
        },
        search: "attention",
      },
      ["ABCD2345", "WXYZ6789"],
    );
    expect(selects(filter, seed("ABCD2345", [["Thesis"]]))).toBe(true);
    expect(selects(filter, seed("WXYZ6789", [["Other"]]))).toBe(false);
  });

  it("keeps the search inside the active facets, the vault's among them", () => {
    const { query, file, filter } = derive(
      { facets: ["annotated", "has-note"], search: "attention" },
      ["ABCD2345"],
    );
    expect(file.filters).toEqual({
      and: ["annotations.length > 0", '["ABCD2345"].contains(indexedKey)'],
    });
    expect(plans(filter)).toBe(true);
    expect(query.vault).toEqual(["has-literature-note"]);
    expect(query.rank).toEqual(["ABCD2345"]);
  });

  it("ranks nothing while the view browses", () => {
    expect(derive({}).query.rank).toBeNull();
  });

  it("narrows a tag: token to the Items with that tag, beside the ranked keys", () => {
    const { filter } = derive({ search: "attention tag:method" }, [
      "ABCD2345",
      "WXYZ6789",
    ]);
    expect(selects(filter, seed("ABCD2345", [], ["method"]))).toBe(true);
    expect(selects(filter, seed("WXYZ6789", [], ["methods"]))).toBe(false);
    expect(selects(filter, seed("QRST2345", [], ["method"]))).toBe(false);
  });

  it("lists every Item with the tag of a search that holds only a tag: token, in the sort", () => {
    const { query, filter, view } = derive({ search: 'tag:"to read"' });
    expect(selects(filter, seed("ABCD2345", [], ["to read"]))).toBe(true);
    expect(selects(filter, seed("WXYZ6789", [], ["to"]))).toBe(false);
    expect(query.rank).toBeNull();
    expect(view.sort).toEqual(DEFAULT_LIBRARY_VIEW_DOCUMENT.sort);
  });

  it("searches all libraries: their Items, with no Collection filter", () => {
    const lab = { type: "group", groupID: 4815 } as const;
    const { query, filter } = derive(
      {
        node: {
          kind: "collection",
          library: { type: "personal" },
          path: ["Thesis"],
        },
        search: "attention",
      },
      ["ABCD2345", "WXYZ6789"],
      [{ type: "personal" }, lab],
    );
    expect(query.libraries).toEqual({
      mode: "selected",
      libraries: [{ type: "personal" }, lab],
    });
    expect(selects(filter, seed("WXYZ6789", [["Other"]]))).toBe(true);
  });
});

describe("searchTerms", () => {
  it("splits the tag: tokens from the words the search ranks by", () => {
    expect(searchTerms("rougier tag:method  fig")).toEqual({
      words: "rougier fig",
      tags: ["method"],
    });
  });

  it('reads a quoted tag with spaces, and "Tag:" as tag:', () => {
    expect(searchTerms('Tag:"to read" tag:a')).toEqual({
      words: "",
      tags: ["to read", "a"],
    });
  });

  it("keeps a bare tag: as a word", () => {
    expect(searchTerms("tag: fig")).toEqual({ words: "tag: fig", tags: [] });
  });
});

describe("libraryViewQuery — the sort and the Layout", () => {
  it("passes the sort to the one Items view, always in the Papers Layout", () => {
    const { view } = derive({
      sort: [
        { property: "title", direction: "ASC" },
        { property: "dateAdded", direction: "DESC" },
      ],
    });
    expect(view).toMatchObject({
      type: "papers",
      name: "Papers",
      from: "items",
      sort: [
        { property: "title", direction: "ASC" },
        { property: "dateAdded", direction: "DESC" },
      ],
    });
    expect(view.order).toBeUndefined();
  });
});

describe("withText", () => {
  it("takes only the sort of a toolbar change, and keeps the node, facets and search", () => {
    const doc: LibraryViewDocument = {
      ...DEFAULT_LIBRARY_VIEW_DOCUMENT,
      node: {
        kind: "collection",
        library: { type: "personal" },
        path: ["Thesis"],
      },
      facets: ["pdf"],
      search: "attention",
    };
    const file = parseQueryFile(
      libraryViewQuery(doc, {
        labels: LABELS,
        scope: SCOPE,
        keys: ["ABCD2345"],
      }).text,
    );
    const view = file.views[0]!;
    const edited = serializeQueryFile({
      ...file,
      views: [
        {
          ...view,
          type: "table",
          sort: [{ property: "title", direction: "ASC" }],
          order: ["title", "date.year"],
        },
      ],
    });
    expect(withText(doc, edited)).toEqual({
      ...doc,
      sort: [{ property: "title", direction: "ASC" }],
    });
  });
});

describe("libraryViewQueryFileText — Save as query file", () => {
  /** The saved file, read back as a Query File tab reads it. */
  function saved(doc: Partial<LibraryViewDocument>) {
    const file = parseQueryFile(
      libraryViewQueryFileText(
        { ...DEFAULT_LIBRARY_VIEW_DOCUMENT, node: MY_LIBRARY, ...doc },
        { labels: LABELS },
      ),
    );
    expect(file.problems).toEqual([]);
    expect(file.views).toHaveLength(1);
    const view = file.views[0]!;
    expect(view.problems).toEqual([]);
    return { file, view, filter: viewFilter(file, view) };
  }

  it("keeps to the Library of the tree node, which a Query File tab does not choose", () => {
    const { filter } = saved({
      node: { kind: "library", library: { type: "group", groupID: 118 } },
    });
    expect(selects(filter, { ...seed("ABCD2345"), groupID: 118 })).toBe(true);
    expect(selects(filter, { ...seed("ABCD2345"), groupID: 7 })).toBe(false);
    expect(selects(filter, seed("ABCD2345"))).toBe(false);
  });

  it("writes Recent with no filter, as a Query File tab reads the Library Scope, newest activity first", () => {
    const { file, view } = saved({ node: { kind: "recent" } });
    expect(file.filters).toBeUndefined();
    expect(view.sort).toEqual([
      { property: "lastActivity", direction: "DESC" },
    ]);
  });

  it("writes no Display Names for Creators and Year", () => {
    expect(saved({}).file.properties).toBeUndefined();
  });

  it("writes the Library alone as the filter of a Library node", () => {
    expect(saved({}).file.filters).toBe('library == "personal"');
  });

  it("keeps to My Library and the selected Collection", () => {
    const { filter } = saved({
      node: {
        kind: "collection",
        library: { type: "personal" },
        path: ["Thesis"],
      },
    });
    expect(plans(filter)).toBe(true);
    expect(selects(filter, seed("ABCD2345", [["Thesis", "Chapter 2"]]))).toBe(
      true,
    );
    expect(
      selects(filter, { ...seed("ABCD2345", [["Thesis"]]), groupID: 118 }),
    ).toBe(false);
    expect(selects(filter, seed("ABCD2345", [["Other"]]))).toBe(false);
  });

  it("writes the selected tags with the rest of the filters", () => {
    const { file, filter } = saved({ tags: ["figure"] });
    expect(file.filters).toEqual({
      and: ['library == "personal"', 'tags.contains("figure")'],
    });
    expect(selects(filter, seed("ABCD2345", [], ["figure"]))).toBe(true);
    expect(selects(filter, seed("WXYZ6789", [], ["talk"]))).toBe(false);
  });

  it("leaves the search out, since a Query File cannot express it", () => {
    const { filter } = saved({ search: "attention" });
    expect(selects(filter, seed("ABCD2345"))).toBe(true);
    expect(filter).not.toContain("indexedKey");
  });

  it("names what the file leaves out: the search, and the facets whose Literature Note check the vault answers", () => {
    expect(
      libraryViewQueryFileLeftOut({
        ...DEFAULT_LIBRARY_VIEW_DOCUMENT,
        facets: ["unread", "annotated", "has-note", "pdf"],
        search: "attention",
      }),
    ).toEqual({ facets: ["unread", "has-note"], search: true });
    expect(
      libraryViewQueryFileLeftOut({
        ...DEFAULT_LIBRARY_VIEW_DOCUMENT,
        facets: ["annotated", "pdf"],
        search: "  ",
      }),
    ).toEqual({ facets: [], search: false });
  });

  it("keeps the view as the Library View shows it: the Papers Layout, the sort and the row limit", () => {
    const { view } = saved({
      sort: [{ property: "title", direction: "ASC" }],
    });
    expect(view).toMatchObject({
      type: "papers",
      name: "Papers",
      from: "items",
      sort: [{ property: "title", direction: "ASC" }],
      limit: 1000,
    });
  });
});
