import { describe, expect, it, vi } from "vitest";

import {
  CITATION_EXAMPLE_IDS,
  citationExampleData,
  isCitationExampleId,
  SAMPLE_ITEMS,
  sampleItemCitation,
} from "./index";

/** The Sample Items the example sets cite, by the citation key each carries. */
const ARTICLE = "ioannidisWhyMost2005";
const BOOK = "Kahneman2011";

describe("citation example sets", () => {
  it("names the six sets a chooser offers", () => {
    expect(CITATION_EXAMPLE_IDS).toEqual([
      "one-item",
      "two-items",
      "item-with-page",
      "suppressed-author",
      "prefix-and-suffix",
      "annotation-citation",
    ]);
    expect(isCitationExampleId("one-item")).toBe(true);
    expect(isCitationExampleId("three-items")).toBe(false);
  });

  it("cites the journal article alone, with no citation-scoped properties", () => {
    const { citations, items } = citationExampleData("one-item", "main");
    expect(citations).toHaveLength(1);
    expect(items[0]).toBe(citations[0]!.item);
    expect(citations[0]).toMatchObject({
      locator: null,
      label: null,
      labelShort: "p.",
      suppressAuthor: false,
      prefix: null,
      suffix: null,
    });
    expect(citations[0]!.item).toMatchObject({
      citationKey: ARTICLE,
      citekey: ARTICLE,
      itemType: "journalArticle",
      title: "Why Most Published Research Findings Are False",
    });
  });

  it("cites the journal article and the book, in that order", () => {
    const { citations, items } = citationExampleData("two-items", "main");
    expect(citations.map(({ item }) => item.citationKey)).toEqual([
      ARTICLE,
      BOOK,
    ]);
    expect(citations.map(({ item }) => item.itemType)).toEqual([
      "journalArticle",
      "book",
    ]);
    expect(items).toEqual(citations.map(({ item }) => item));
  });

  it("pins a page range, a suppressed author, and a prefix with a suffix", () => {
    expect(
      citationExampleData("item-with-page", "main").citations[0],
    ).toMatchObject({ locator: "12-14", label: "page", labelShort: "p." });
    expect(
      citationExampleData("suppressed-author", "main").citations[0],
    ).toMatchObject({ suppressAuthor: true, locator: null });
    expect(
      citationExampleData("prefix-and-suffix", "main").citations[0],
    ).toMatchObject({ prefix: "see ", suffix: " for a review" });
  });

  it("pins the highlight Sample Annotation's page on the annotation citation", () => {
    expect(
      citationExampleData("annotation-citation", "main").citations[0],
    ).toMatchObject({ locator: "1", label: "page" });
  });

  it("hands the requested variant through unchanged", () => {
    for (const id of CITATION_EXAMPLE_IDS) {
      expect(citationExampleData(id, "alt").variant).toBe("alt");
      expect(citationExampleData(id, "main").variant).toBe("main");
    }
  });

  it("leaves the note-root properties off a cited item and keeps its Zotero fields", () => {
    const [citation] = citationExampleData("one-item", "main").citations;
    const item = citation!.item;
    for (const absent of [
      "key",
      "indexedKey",
      "libraryID",
      "groupID",
      "dateAdded",
      "dateModified",
      "tags",
      "notePath",
      "noteLink",
      "authors",
      "authorsShort",
      "collections",
    ]) {
      expect(item, absent).not.toHaveProperty(absent);
    }
    expect(item.publicationTitle).toBe("PLoS Medicine");
    expect(item.containerTitle).toBe("PLoS Medicine");
  });

  it("loads the render entry on a runtime that has yet to install Temporal", async () => {
    // The web Workbench statically imports this entry and installs its
    // `Temporal` polyfill in an effect, so nothing here may restore a Sample
    // Item's dates at import time.
    vi.resetModules();
    const native = globalThis.Temporal;
    Reflect.deleteProperty(globalThis, "Temporal");
    try {
      const entry = await import("./index");
      expect(entry.CITATION_EXAMPLE_IDS).toHaveLength(6);
      expect(() => entry.citationExampleData("one-item", "main")).toThrow(
        /Temporal is not defined/,
      );
    } finally {
      globalThis.Temporal = native;
    }
  });

  it("renders a chosen Sample Item as a one-item set with no locator", () => {
    const { citations, variant } = sampleItemCitation(SAMPLE_ITEMS[0]!, "alt");
    expect(variant).toBe("alt");
    expect(citations).toHaveLength(1);
    expect(citations[0]!.item.citationKey).toBe(ARTICLE);
    expect(citations[0]!.locator).toBeNull();
  });
});
