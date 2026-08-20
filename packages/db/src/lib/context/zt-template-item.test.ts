import { describe, expect, it } from "vitest";

import type { ItemFields } from "@zotlit/zotero-types";

import { USER_LIBRARY_ID } from "@/lib/constants";
import type { BaseItem, Item } from "@/queries/items";

import { itemToTemplateBaseData, resolveItemCore } from "./zt-template-item";
import type { TemplateCreator } from "./zt-template-item";

function makeItem(
  fields: { itemType: string } & Record<string, string | null>,
  base?: Partial<BaseItem>,
): Item {
  return {
    itemID: 1,
    libraryID: USER_LIBRARY_ID,
    key: "ABC12345",
    indexedKey: "ABC12345",
    dateAdded: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    creators: [],
    primaryCreatorType: null,
    customFields: new Map(),
    groupID: null,
    ...base,
    fields: fields as ItemFields,
  };
}

describe("itemToTemplateBaseData", () => {
  it("maps basic item fields", () => {
    const item = makeItem({
      itemType: "journalArticle",
      title: "A Study",
      abstractNote: "Lorem ipsum",
      publicationTitle: "Nature",
      DOI: "10.1234/test",
      volume: "42",
      issue: "3",
      pages: "100-110",
      date: "2024-06-00 June 2024",
    });

    const result = itemToTemplateBaseData({ item, tags: [] });

    expect(result.key).toBe("ABC12345");
    expect(result.itemType).toBe("journalArticle");
    expect(result.title).toBe("A Study");
    expect(result.abstract).toBe("Lorem ipsum");
    expect(result.containerTitle).toBe("Nature");
    expect(result.DOI).toBe("10.1234/test");
    expect(result.volume).toBe("42");
    expect(result.issue).toBe("3");
    expect(result.pages).toBe("100-110");
    expect(result.date).toEqual({
      kind: "yearMonth",
      value: Temporal.PlainYearMonth.from({ year: 2024, month: 6 }),
      year: 2024,
      month: 6,
      day: null,
      raw: "2024-06-00 June 2024",
    });
  });

  it("normalizes field aliases to canonical names", () => {
    const item = makeItem({
      itemType: "blogPost",
      title: "My Post",
      blogTitle: "Tech Blog",
    });

    const result = itemToTemplateBaseData({ item, tags: [] });

    expect(result.containerTitle).toBe("Tech Blog");
    expect(result.publicationTitle).toBe("Tech Blog");
  });

  it("normalizes publisher aliases", () => {
    const item = makeItem({
      itemType: "audioRecording",
      label: "Sony Music",
    });

    const result = itemToTemplateBaseData({ item, tags: [] });

    expect(result.publisher).toBe("Sony Music");
  });

  it("converts two-field creators", () => {
    const item = makeItem(
      { itemType: "book" },
      {
        creators: [
          {
            firstName: "Jane",
            lastName: "Smith",
            creatorType: "author",
            fieldMode: 0,
          },
          {
            firstName: "Bob",
            lastName: "Jones",
            creatorType: "editor",
            fieldMode: 0,
          },
        ],
      },
    );

    const result = itemToTemplateBaseData({ item, tags: [] });

    expect(result.creators).toEqual<readonly TemplateCreator[]>([
      {
        family: "Smith",
        given: "Jane",
        literal: null,
        role: "author",
        fullName: "Jane Smith",
      },
      {
        family: "Jones",
        given: "Bob",
        literal: null,
        role: "editor",
        fullName: "Bob Jones",
      },
    ]);
  });

  it("converts institutional creators (fieldMode=1)", () => {
    const item = makeItem(
      { itemType: "report" },
      {
        creators: [
          {
            firstName: null,
            lastName: "World Health Organization",
            creatorType: "author",
            fieldMode: 1,
          },
        ],
      },
    );

    const result = itemToTemplateBaseData({ item, tags: [] });

    expect(result.creators[0]).toEqual<TemplateCreator>({
      family: "",
      given: "",
      literal: "World Health Organization",
      role: "author",
      fullName: "World Health Organization",
    });
  });

  it("includes custom fields as direct properties", () => {
    const item = makeItem(
      { itemType: "journalArticle" },
      { customFields: new Map([["myCustomField", "custom value"]]) },
    );

    const result = itemToTemplateBaseData({ item, tags: [] });

    expect(result.myCustomField).toBe("custom value");
  });

  it("returns null for missing common fields", () => {
    const item = makeItem({ itemType: "book" });
    const result = itemToTemplateBaseData({ item, tags: [] });

    expect(result.title).toBeNull();
    expect(result.abstract).toBeNull();
    expect(result.containerTitle).toBeNull();
    expect(result.date).toBeNull();
    expect(result.DOI).toBeNull();
  });

  it("exposes renamed fields under both names", () => {
    const item = makeItem({
      itemType: "journalArticle",
      abstractNote: "Test abstract",
      publicationTitle: "Science",
    });

    const result = itemToTemplateBaseData({ item, tags: [] });

    expect(result.abstract).toBe("Test abstract");
    expect(result.abstractNote).toBe("Test abstract");
    expect(result.containerTitle).toBe("Science");
    expect(result.publicationTitle).toBe("Science");
  });

  it("exposes citationKey under the citekey alias", () => {
    const item = makeItem({
      itemType: "journalArticle",
      citationKey: "smith2024",
    });

    const result = itemToTemplateBaseData({ item, tags: [] });

    expect(result.citationKey).toBe("smith2024");
    expect(result.citekey).toBe("smith2024");
  });

  it("defaults tags to empty array", () => {
    const result = itemToTemplateBaseData({
      item: makeItem({ itemType: "book" }),
      tags: [],
    });

    expect(result.tags).toEqual([]);
  });

  it("normalizes an empty-string field value to absent/null", () => {
    const item = makeItem({
      itemType: "journalArticle",
      title: "A Study",
      abstractNote: "",
    });

    const result = itemToTemplateBaseData({ item, tags: [] });

    expect(result.abstract).toBeNull();
    expect(result.abstractNote).toBeUndefined();
    expect("abstractNote" in result).toBe(false);
    // Unaffected fields still come through.
    expect(result.title).toBe("A Study");
  });

  it("skips an empty-string customFields entry", () => {
    const item = makeItem(
      { itemType: "journalArticle" },
      { customFields: new Map([["myCustomField", ""]]) },
    );

    const result = itemToTemplateBaseData({ item, tags: [] });

    expect(result.myCustomField).toBeUndefined();
    expect("myCustomField" in result).toBe(false);
  });
});

describe("resolveItemCore", () => {
  it.each([
    {
      label: "prefers the populated primary role",
      creators: [
        { firstName: "Ada", lastName: "Lovelace", creatorType: "author" },
        { firstName: "Ruth", lastName: "Davis", creatorType: "editor" },
      ],
      primaryCreatorType: "author",
      family: "Lovelace",
      role: "author",
    },
    {
      label: "falls back to editors",
      creators: [
        { firstName: "Ruth", lastName: "Davis", creatorType: "editor" },
      ],
      primaryCreatorType: "author",
      family: "Davis",
      role: "editor",
    },
    {
      label: "falls back to directors after editors",
      creators: [
        { firstName: "Ruth", lastName: "Davis", creatorType: "director" },
        { firstName: "Con", lastName: "Tribe", creatorType: "contributor" },
      ],
      primaryCreatorType: "author",
      family: "Davis",
      role: "director",
    },
    {
      label: "falls back to contributors",
      creators: [
        { firstName: "Con", lastName: "Tribe", creatorType: "contributor" },
      ],
      primaryCreatorType: "author",
      family: "Tribe",
      role: "contributor",
    },
  ] as const)("$label", ({ creators, primaryCreatorType, family, role }) => {
    const item = makeItem(
      { itemType: "book" },
      {
        primaryCreatorType,
        creators: creators.map((creator) => ({ ...creator, fieldMode: 0 })),
      },
    );
    const baseData = itemToTemplateBaseData({ item, tags: [] });

    const result = resolveItemCore({
      item,
      baseData,
      username: null,
      authorsShort: () => family,
    });

    expect(result.authors).toMatchObject([{ family, role }]);
    expect(result.authorsShort).toBe(family);
  });
});
