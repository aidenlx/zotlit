import { describe, expect, it } from "vitest";

import { FIELD_LABELS } from "@zotlit/zotero-types/field-labels";

import { fieldSearchTerms, matchesSearchTerm } from "./field-search-terms";

const offers = (
  dataset: Parameters<typeof fieldSearchTerms>[0],
  path: string,
  query: string,
) =>
  fieldSearchTerms(dataset, path).some((term) =>
    matchesSearchTerm(term, query),
  );

describe("fieldSearchTerms", () => {
  it.each([
    ["publicationTitle", "journal"],
    ["publicationTitle", "journal name"],
    ["publicationTitle", "periodical"],
    ["publicationTitle", "container-title"],
    ["publicationTitle", "期刊"],
    ["abstractNote", "summary"],
    ["DOI", "digital object identifier"],
    ["pages", "page range"],
    ["issue", "number"],
    ["numPages", "page count"],
    ["place", "city"],
    ["university", "school"],
    ["citationKey", "citekey"],
    ["creators", "author"],
    ["creators", "editor"],
    ["tags", "keyword"],
    ["collections", "folder"],
    ["date.year", "publication year"],
    ["date.year", "年份"],
  ])("finds %s by %s on Items", (path, query) => {
    expect(offers("items", path, query)).toBe(true);
  });

  it("finds an Item field through its parent path", () => {
    expect(offers("attachments", "item.publicationTitle", "journal")).toBe(
      true,
    );
    expect(offers("annotations", "item.publicationTitle", "journal")).toBe(
      true,
    );
  });

  it("reads a path below a field by that field's terms", () => {
    expect(offers("items", "firstAuthor.family", "surname")).toBe(true);
    expect(offers("items", "firstAuthor.given", "lead author")).toBe(true);
  });

  it("gives a name its dataset's meaning", () => {
    expect(offers("annotations", "text", "quote")).toBe(true);
    expect(offers("annotations", "comment", "note")).toBe(true);
    expect(offers("annotations", "pageLabel", "page number")).toBe(true);
    expect(offers("annotations", "attachment.path", "file path")).toBe(true);
    expect(offers("attachments", "title", "file name")).toBe(true);
    expect(offers("attachments", "title", "article title")).toBe(false);
  });

  it("connects a base field and its type-specific fields both ways", () => {
    expect(offers("items", "publicationTitle", "proceedings")).toBe(true);
    expect(offers("items", "proceedingsTitle", "publication")).toBe(true);
    expect(offers("items", "publisher", "institution")).toBe(true);
  });

  it("finds a field in either language whatever the display language", () => {
    expect(offers("items", "volume", "卷")).toBe(true);
    expect(offers("items", "volume", "Volume")).toBe(true);
  });

  it("has terms of its own for every Zotero field", () => {
    const zotero = Object.keys(FIELD_LABELS["en-US"]);
    expect(zotero.length).toBeGreaterThan(100);
    const bare = zotero.filter((name) => {
      const labels = [
        FIELD_LABELS["en-US"][name],
        FIELD_LABELS["zh-CN"][name],
        name,
      ].map((text) => text?.toLowerCase());
      return fieldSearchTerms("items", name).every((term) =>
        labels.includes(term),
      );
    });
    expect(bare).toEqual([]);
  });
});

describe("matchesSearchTerm", () => {
  it("matches the start of the term or of one of its words, in any case", () => {
    expect(matchesSearchTerm("journal name", "jour")).toBe(true);
    expect(matchesSearchTerm("journal name", "NAME")).toBe(true);
    expect(matchesSearchTerm("container-title", "title")).toBe(true);
  });

  it("matches inside a Chinese term, which has no word breaks", () => {
    expect(matchesSearchTerm("期刊名称", "名称")).toBe(true);
  });

  it("reads no scattered letters, and no empty query", () => {
    expect(matchesSearchTerm("journal", "jnl")).toBe(false);
    expect(matchesSearchTerm("journal", "ourn")).toBe(false);
    expect(matchesSearchTerm("journal", "  ")).toBe(false);
  });
});
