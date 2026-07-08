import { describe, expect, it } from "vitest";

import { makeItem } from "@/test-utils";

import {
  citekeysToCiteTemplateData,
  resolveCitedItem,
} from "./zt-template-cite";

describe("citekeysToCiteTemplateData", () => {
  it("wraps each citekey in a citekey-only stub item at default citation props", () => {
    const { items, citations } = citekeysToCiteTemplateData([
      { citationKey: "smith2024" },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      citationKey: "smith2024",
      citekey: "smith2024",
      itemType: null,
      title: null,
      creators: [],
      date: null,
    });
    expect(citations[0]).toMatchObject({
      locator: null,
      label: null,
      labelShort: "p.",
      suppressAuthor: false,
      prefix: null,
      suffix: null,
    });
  });

  it("carries a null citekey through unchanged (unresolved cite item)", () => {
    const { items } = citekeysToCiteTemplateData([{ citationKey: null }]);

    expect(items[0]).toMatchObject({ citationKey: null, citekey: null });
  });

  it("keeps citations[i].item identical to items[i] and in order", () => {
    const { items, citations } = citekeysToCiteTemplateData([
      { citationKey: "a2020" },
      { citationKey: "b2021" },
    ]);

    expect(citations.map((c) => c.item.citationKey)).toEqual([
      "a2020",
      "b2021",
    ]);
    expect(citations[0]?.item).toBe(items[0]);
    expect(citations[1]?.item).toBe(items[1]);
  });

  it("threads a ref's citation-scoped props onto the Citation Item instead of stubbing defaults", () => {
    const { citations } = citekeysToCiteTemplateData([
      {
        citationKey: "smith2024",
        locator: "62",
        label: "page",
        labelShort: "p.",
        suppressAuthor: true,
        prefix: "see",
        suffix: "n. 4",
      },
    ]);

    expect(citations[0]).toMatchObject({
      locator: "62",
      label: "page",
      labelShort: "p.",
      suppressAuthor: true,
      prefix: "see",
      suffix: "n. 4",
    });
  });

  it("falls back to default citation props for a ref missing them (DB-query leg)", () => {
    const { citations } = citekeysToCiteTemplateData([
      { citationKey: "doe2020" },
    ]);

    expect(citations[0]).toMatchObject({
      locator: null,
      label: null,
      labelShort: "p.",
      suppressAuthor: false,
      prefix: null,
      suffix: null,
    });
  });

  describe("DB item data (9.2-CSL #03)", () => {
    it("narrows a full DB item's title/creators/date/containerTitle onto the cite item", () => {
      const item = makeItem({
        itemType: "journalArticle",
        title: "Stated choice methods",
        publicationTitle: "Transport Reviews",
        date: "2011",
      });

      const { items } = citekeysToCiteTemplateData([
        { citationKey: "Hensher2011", item },
      ]);

      expect(items[0]).toMatchObject({
        citationKey: "Hensher2011",
        citekey: "Hensher2011",
        itemType: "journalArticle",
        title: "Stated choice methods",
        containerTitle: "Transport Reviews",
      });
      expect(items[0]?.date).toMatchObject({ year: 2011 });
      expect(items[0]?.creators[0]).toMatchObject({
        family: "Hensher",
        given: "David",
      });
    });

    it("excludes vault/DB-only context (tags, dates-added/modified, library identity, resolvers) from the narrowed cite item", () => {
      const item = makeItem({
        itemType: "journalArticle",
        title: "Stated choice methods",
      });

      const { items } = citekeysToCiteTemplateData([
        { citationKey: "Hensher2011", item },
      ]);

      expect(items[0]).not.toHaveProperty("tags");
      expect(items[0]).not.toHaveProperty("dateAdded");
      expect(items[0]).not.toHaveProperty("dateModified");
      expect(items[0]).not.toHaveProperty("libraryID");
      expect(items[0]).not.toHaveProperty("groupID");
      expect(items[0]).not.toHaveProperty("notePath");
      expect(items[0]).not.toHaveProperty("noteLink");
      expect(items[0]).not.toHaveProperty("collections");
    });

    it("keeps the ref's resolved citekey even when the item itself has none (mixed legs: DB item + embedded-snapshot key)", () => {
      const item = makeItem({
        itemType: "journalArticle",
        title: "Stated choice methods",
        citationKey: null,
      });

      const { items } = citekeysToCiteTemplateData([
        { citationKey: "Embedded2020", item },
      ]);

      expect(items[0]).toMatchObject({
        citationKey: "Embedded2020",
        citekey: "Embedded2020",
        title: "Stated choice methods",
      });
    });
  });
});

describe("resolveCitedItem (three-tier Citation policy)", () => {
  const snapshot = {
    id: "http://zotero.org/users/local/x/items/KX67D9YM",
    type: "article-journal",
    title: "Embedded title",
    "citation-key": "SnapKey",
  };

  it("tier 1 — the live DB row wins over an embedded snapshot", () => {
    const item = makeItem({
      itemType: "journalArticle",
      title: "Live DB title",
    });

    const resolved = resolveCitedItem(item, snapshot, "Hensher2011");

    expect(resolved).toMatchObject({
      citationKey: "Hensher2011",
      citekey: "Hensher2011",
      title: "Live DB title",
    });
  });

  it("tier 2 — the embedded snapshot resolves when no DB row, ref citekey overrides the snapshot's own", () => {
    const resolved = resolveCitedItem(undefined, snapshot, "RefKey");

    expect(resolved).toMatchObject({
      title: "Embedded title",
      itemType: "journalArticle",
      citationKey: "RefKey",
      citekey: "RefKey",
    });
  });

  it("tier 3 — a citekey-only stub when neither DB row nor snapshot is present", () => {
    const resolved = resolveCitedItem(undefined, undefined, "OnlyKey");

    expect(resolved).toMatchObject({
      citationKey: "OnlyKey",
      citekey: "OnlyKey",
      itemType: null,
      title: null,
      creators: [],
      date: null,
    });
  });

  it("carries a null citekey through the stub (unresolvable ref)", () => {
    expect(resolveCitedItem(undefined, undefined, null)).toMatchObject({
      citationKey: null,
      citekey: null,
    });
  });
});
