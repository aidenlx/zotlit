// The Library View Document becomes the Query View's text: these tests read
// the text back as the Query View does, and ask the engine what its filter
// selects.
import { describe, expect, it } from "vitest";

import { planItemFilter, testItemSeed } from "@zotlit/item-query";
import type { QueryItemSeed } from "@zotlit/item-query";

import {
  parseQueryFile,
  serializeQueryFile,
  viewFilter,
} from "@/views/query-view/query-file";

import { DEFAULT_LIBRARY_VIEW_DOCUMENT } from "./document";
import type { LibraryViewDocument } from "./document";
import { documentWithText, libraryViewQuery } from "./query-text";

const LABELS = { papers: "Papers", creators: "Creators", year: "Year" };

/** An Item of My Library, in the Collections at `paths`. */
function seed(key: string, paths: string[][] = []): QueryItemSeed {
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
    tags: [],
    collections: paths,
  };
}

function derive(doc: Partial<LibraryViewDocument>, keys?: readonly string[]) {
  const query = libraryViewQuery(
    { ...DEFAULT_LIBRARY_VIEW_DOCUMENT, ...doc },
    { labels: LABELS, ...(keys && { keys }) },
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

  it("ranks nothing while the view browses", () => {
    expect(derive({}).query.rank).toBeNull();
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

describe("documentWithText", () => {
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
      libraryViewQuery(doc, { labels: LABELS, keys: ["ABCD2345"] }).text,
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
    expect(documentWithText(doc, edited)).toEqual({
      ...doc,
      sort: [{ property: "title", direction: "ASC" }],
      order: ["title", "date.year"],
    });
  });

  it("keeps the document's Layout where the text names one the Library View does not offer", () => {
    const text = libraryViewQuery(DEFAULT_LIBRARY_VIEW_DOCUMENT, {
      labels: LABELS,
    }).text.replace("type: table", "type: cards");
    expect(documentWithText(DEFAULT_LIBRARY_VIEW_DOCUMENT, text).layout).toBe(
      "table",
    );
  });
});
