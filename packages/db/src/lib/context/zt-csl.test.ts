import { describe, expect, it } from "vitest";

import { cslToTemplateItem } from "./zt-csl";

/**
 * A cited item's embedded CSL-JSON, as Zotero hoists it onto a note container's
 * `data-citation-items`. The reverse mapper turns this into the narrowed
 * {@link TemplateCiteItemData} cite legs share.
 */
function csl(data: Record<string, unknown>): Record<string, unknown> {
  return { id: "http://zotero.org/users/local/x/items/KX67D9YM", ...data };
}

describe("cslToTemplateItem: text variables", () => {
  it("maps title through the identity text mapping", () => {
    const item = cslToTemplateItem(csl({ title: "Stated choice methods" }));
    expect(item.title).toBe("Stated choice methods");
  });

  it("maps container-title onto the CSL-aliased containerTitle", () => {
    const item = cslToTemplateItem(
      csl({ "container-title": "Transport Reviews" }),
    );
    expect(item.containerTitle).toBe("Transport Reviews");
  });

  it("maps abstract onto the CSL-aliased abstract", () => {
    const item = cslToTemplateItem(csl({ abstract: "A short summary." }));
    expect(item.abstract).toBe("A short summary.");
  });

  it("canonicalizes CSL page onto the Zotero pages field", () => {
    const item = cslToTemplateItem(csl({ page: "62-80" }));
    expect(item.pages).toBe("62-80");
  });

  it("maps publisher-place onto place and DOI through", () => {
    const item = cslToTemplateItem(
      csl({ "publisher-place": "London", DOI: "10.1000/xyz" }),
    );
    expect(item.place).toBe("London");
    expect(item.DOI).toBe("10.1000/xyz");
  });

  it("leaves absent text fields null", () => {
    const item = cslToTemplateItem(csl({}));
    expect(item.title).toBeNull();
    expect(item.containerTitle).toBeNull();
    expect(item.abstract).toBeNull();
  });
});

describe("cslToTemplateItem: type", () => {
  it("maps a CSL type to its first Zotero item type candidate", () => {
    expect(cslToTemplateItem(csl({ type: "article-journal" })).itemType).toBe(
      "journalArticle",
    );
    expect(cslToTemplateItem(csl({ type: "chapter" })).itemType).toBe(
      "bookSection",
    );
    expect(cslToTemplateItem(csl({ type: "book" })).itemType).toBe("book");
  });
});

describe("cslToTemplateItem: name variables", () => {
  it("maps CSL name variables to creators carrying their Zotero role", () => {
    const item = cslToTemplateItem(
      csl({
        author: [{ family: "Hensher", given: "David" }],
        editor: [{ family: "Rose", given: "John" }],
      }),
    );
    expect(item.creators).toEqual([
      expect.objectContaining({
        family: "Hensher",
        given: "David",
        role: "author",
      }),
      expect.objectContaining({
        family: "Rose",
        given: "John",
        role: "editor",
      }),
    ]);
  });

  it("reports the primary creator type from the first author", () => {
    const item = cslToTemplateItem(
      csl({ author: [{ family: "Hensher", given: "David" }] }),
    );
    expect(item.primaryCreatorType).toBe("author");
  });

  it("maps an institutional (literal) name to a literal creator", () => {
    const item = cslToTemplateItem(
      csl({ author: [{ literal: "World Health Organization" }] }),
    );
    expect(item.creators[0]).toMatchObject({
      literal: "World Health Organization",
      family: "",
      given: "",
      role: "author",
    });
  });

  it("leaves creators empty when no name variables are present", () => {
    expect(cslToTemplateItem(csl({})).creators).toEqual([]);
  });
});

describe("cslToTemplateItem: issued date", () => {
  it("maps a full date-parts triple to a Y/M/D item date", () => {
    const { date } = cslToTemplateItem(
      csl({ issued: { "date-parts": [[2011, 3, 15]] } }),
    );
    expect(date).toMatchObject({ kind: "date", year: 2011, month: 3, day: 15 });
  });

  it("maps a year-only date-parts entry to a year item date", () => {
    const { date } = cslToTemplateItem(
      csl({ issued: { "date-parts": [[2011]] } }),
    );
    expect(date).toMatchObject({ kind: "year", year: 2011 });
  });

  it("maps a literal issued date to a text item date", () => {
    const { date } = cslToTemplateItem(
      csl({ issued: { literal: "Spring 2011" } }),
    );
    expect(date).toMatchObject({ kind: "text", year: 2011 });
    expect(date?.toString()).toContain("Spring 2011");
  });

  it("leaves date null when issued is absent", () => {
    expect(cslToTemplateItem(csl({})).date).toBeNull();
  });
});

describe("cslToTemplateItem: citation-key", () => {
  it("maps citation-key onto both citationKey and citekey", () => {
    const item = cslToTemplateItem(csl({ "citation-key": "Hensher2011" }));
    expect(item.citationKey).toBe("Hensher2011");
    expect(item.citekey).toBe("Hensher2011");
  });

  it("leaves both citekey aliases null when citation-key is absent", () => {
    const item = cslToTemplateItem(csl({}));
    expect(item.citationKey).toBeNull();
    expect(item.citekey).toBeNull();
  });
});
