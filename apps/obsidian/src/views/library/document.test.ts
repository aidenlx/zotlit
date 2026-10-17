import { describe, expect, it } from "vitest";

import {
  DEFAULT_LIBRARY_VIEW_DOCUMENT,
  parseLibraryViewDocument,
  serializeLibraryViewDocument,
} from "./document";
import type { LibraryViewDocument } from "./document";

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

  it("opens My Library on a Table, newest first, when plugin data holds no document", () => {
    expect(parseLibraryViewDocument(null)).toEqual({
      node: { kind: "library", library: { type: "personal" } },
      facets: [],
      search: "",
      sort: [{ property: "dateModified", direction: "DESC" }],
      layout: "table",
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
