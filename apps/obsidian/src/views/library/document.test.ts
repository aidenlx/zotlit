// The Library View Document: how plugin data reads back, how each change
// takes it, and the Query View's text it becomes. The derivation tests read
// the text back as the Query View does, and ask the engine what its filter
// selects.
import { describe, expect, it } from "vitest";

import { planItemFilter, testItemSeed } from "@zotlit/item-query";
import type { QueryItemSeed } from "@zotlit/item-query";

import type { LibrarySelector } from "@/services/library-scope/scope";
import {
  parseQueryFile,
  serializeQueryFile,
  viewFilter,
} from "@/views/query-view/query-file";

import {
  DEFAULT_LIBRARY_VIEW_DOCUMENT,
  libraryViewQuery,
  libraryViewQueryFileLeftOut,
  libraryViewQueryFileText,
  parseLibraryViewDocument,
  serializeLibraryViewDocument,
  withNode,
  withText,
} from "./document";
import type { LibraryViewDocument } from "./document";
import { searchTerms } from "./search";

/** A document with a value other than the default in every field. */
const CHAPTER: LibraryViewDocument = {
  node: {
    kind: "collection",
    library: { type: "group", groupID: 4200309 },
    path: ["Thesis", "Chapter 2"],
  },
  facets: ["annotated", "pdf"],
  search: "attention tag:method",
  sort: [
    { property: "title", direction: "ASC" },
    { property: "dateAdded", direction: "DESC" },
  ],
  layout: "table",
  order: ["title", "firstAuthor", "vault.literatureNote"],
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
      search: "",
      sort: [{ property: "dateModified", direction: "DESC" }],
      layout: "papers",
      order: ["title", "creators", "date.year", "vault.literatureNote"],
    });
  });

  it("takes the default for each field it cannot read, keeps the others and drops a facet it does not know", () => {
    const parsed = parseLibraryViewDocument({
      node: { kind: "collection", library: { type: "personal" }, path: [] },
      facets: ["annotated", "starred"],
      search: 42,
      sort: [{ property: "title", direction: "sideways" }],
      layout: "papyrus",
      order: ["title"],
    });
    expect(parsed).toEqual({
      ...DEFAULT_LIBRARY_VIEW_DOCUMENT,
      facets: ["annotated"],
      order: ["title"],
    });
  });

  it("reads each facet once, in the order the tree shows them", () => {
    expect(
      parseLibraryViewDocument({
        facets: ["pdf", "unread", "pdf", "has-note"],
      }).facets,
    ).toEqual(["unread", "has-note", "pdf"]);
  });
});

describe("withNode", () => {
  it("selects a Library or a Collection and keeps the sort", () => {
    const node = { kind: "library", library: { type: "personal" } } as const;
    expect(withNode(CHAPTER, node)).toEqual({ ...CHAPTER, node });
  });

  it("selects Recent with its sort, newest change first, and keeps the rest", () => {
    expect(withNode(CHAPTER, { kind: "recent" })).toEqual({
      ...CHAPTER,
      node: { kind: "recent" },
      sort: [{ property: "dateModified", direction: "DESC" }],
    });
  });

  it("leaves Recent for a Collection with no sort where the sort is still Recent's own", () => {
    const recent = withNode(CHAPTER, { kind: "recent" });
    expect(withNode(recent, CHAPTER.node)).toEqual({ ...CHAPTER, sort: [] });
  });

  it("leaves Recent with the sort the researcher set there", () => {
    const sort = [{ property: "title", direction: "ASC" }] as const;
    const recent = { ...CHAPTER, node: { kind: "recent" }, sort } as const;
    expect(withNode(recent, MY_LIBRARY)).toEqual({
      ...CHAPTER,
      node: MY_LIBRARY,
      sort,
    });
  });

  it("keeps a newest-change-first sort that the researcher set on a Collection", () => {
    const sort = [{ property: "dateModified", direction: "DESC" }] as const;
    expect(withNode({ ...CHAPTER, sort }, MY_LIBRARY)).toEqual({
      ...CHAPTER,
      node: MY_LIBRARY,
      sort,
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

  it("reads Unread as an Item with no Annotation, and no Literature Note in the vault", () => {
    const { query, file, filter } = derive({ facets: ["unread"] });
    expect(file.filters).toBe("annotations.isEmpty()");
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

describe("libraryViewQuery — sort, Layout and Visible Properties", () => {
  it("passes the sort, the Layout and the Visible Properties to the one Items view", () => {
    const { view } = derive({
      sort: [
        { property: "title", direction: "ASC" },
        { property: "dateAdded", direction: "DESC" },
      ],
      layout: "table",
      order: ["title", "firstAuthor"],
    });
    expect(view).toMatchObject({
      type: "table",
      name: "Papers",
      from: "items",
      sort: [
        { property: "title", direction: "ASC" },
        { property: "dateAdded", direction: "DESC" },
      ],
      order: ["title", "firstAuthor"],
    });
  });
});

describe("withText", () => {
  it("takes the sort, the Layout and the Visible Properties of a toolbar change, and keeps the node, facets and search", () => {
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
          sort: [{ property: "title", direction: "ASC" }],
          order: ["title", "date.year"],
        },
      ],
    });
    expect(withText(doc, edited)).toEqual({
      ...doc,
      sort: [{ property: "title", direction: "ASC" }],
      order: ["title", "date.year"],
    });
  });

  it("keeps the document's Layout where the text names one the Library View does not offer", () => {
    const text = libraryViewQuery(DEFAULT_LIBRARY_VIEW_DOCUMENT, {
      labels: LABELS,
      scope: SCOPE,
    }).text.replace("type: papers", "type: cards");
    expect(withText(DEFAULT_LIBRARY_VIEW_DOCUMENT, text).layout).toBe("papers");
  });

  it("takes the Layout of a switch between Papers and the Table", () => {
    const text = libraryViewQuery(DEFAULT_LIBRARY_VIEW_DOCUMENT, {
      labels: LABELS,
      scope: SCOPE,
    }).text.replace("type: papers", "type: table");
    expect(withText(DEFAULT_LIBRARY_VIEW_DOCUMENT, text).layout).toBe("table");
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

  it("writes Recent with no filter, as a Query File tab reads the Library Scope, newest change first", () => {
    const { file, view } = saved({ node: { kind: "recent" } });
    expect(file.filters).toBeUndefined();
    expect(view.sort).toEqual([
      { property: "dateModified", direction: "DESC" },
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

  it("keeps the view as the Library View shows it: sort, Layout, Visible Properties and row limit", () => {
    const { view } = saved({
      sort: [{ property: "title", direction: "ASC" }],
      layout: "table",
      order: ["title", "vault.literatureNote"],
    });
    expect(view).toMatchObject({
      type: "table",
      name: "Papers",
      from: "items",
      sort: [{ property: "title", direction: "ASC" }],
      order: ["title", "vault.literatureNote"],
      limit: 1000,
    });
  });
});
