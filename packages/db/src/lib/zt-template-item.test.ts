import { describe, expect, it } from "vitest";

import { Temporal } from "@zotlit/shared/temporal";

import { USER_LIBRARY_ID } from "@/lib/constants";
import { type Item } from "@/queries/items";

import { itemToTemplateData, type TemplateCreator } from "./zt-template-item";

function makeItem(overrides: Partial<Item> & { itemType: string }): Item {
  return {
    itemID: 1,
    libraryID: USER_LIBRARY_ID,
    key: "ABC12345",
    indexedKey: "ABC12345",
    dateModified: Temporal.Instant.from("2024-01-15T10:00:00Z"),
    creators: [],
    primaryCreatorType: null,
    customFields: new Map(),
    ...overrides,
  } as Item;
}

describe("itemToTemplateData", () => {
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

    const result = itemToTemplateData(item);

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
      plain: Temporal.PlainYearMonth.from({ year: 2024, month: 6 }),
      raw: "2024-06-00 June 2024",
    });
  });

  it("normalizes field aliases to canonical names", () => {
    const item = makeItem({
      itemType: "blogPost",
      title: "My Post",
      blogTitle: "Tech Blog",
    } as Partial<Item> & { itemType: string });

    const result = itemToTemplateData(item);

    expect(result.containerTitle).toBe("Tech Blog");
    expect(result.publicationTitle).toBe("Tech Blog");
  });

  it("normalizes publisher aliases", () => {
    const item = makeItem({
      itemType: "audioRecording",
      label: "Sony Music",
    } as Partial<Item> & { itemType: string });

    const result = itemToTemplateData(item);

    expect(result.publisher).toBe("Sony Music");
  });

  it("converts two-field creators", () => {
    const item = makeItem({
      itemType: "book",
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
    });

    const result = itemToTemplateData(item);

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
    const item = makeItem({
      itemType: "report",
      creators: [
        {
          firstName: null,
          lastName: "World Health Organization",
          creatorType: "author",
          fieldMode: 1,
        },
      ],
    });

    const result = itemToTemplateData(item);

    expect(result.creators[0]).toEqual<TemplateCreator>({
      family: "",
      given: "",
      literal: "World Health Organization",
      role: "author",
      fullName: "World Health Organization",
    });
  });

  it("includes custom fields as direct properties", () => {
    const item = makeItem({
      itemType: "journalArticle",
      customFields: new Map([["myCustomField", "custom value"]]),
    });

    const result = itemToTemplateData(item);

    expect(result.myCustomField).toBe("custom value");
  });

  it("returns null for missing common fields", () => {
    const item = makeItem({ itemType: "book" });
    const result = itemToTemplateData(item);

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

    const result = itemToTemplateData(item);

    expect(result.abstract).toBe("Test abstract");
    expect(result.abstractNote).toBe("Test abstract");
    expect(result.containerTitle).toBe("Science");
    expect(result.publicationTitle).toBe("Science");
  });

  it("exposes citationKey under the citekey alias", () => {
    const item = makeItem({
      itemType: "journalArticle",
      citationKey: "smith2024",
    } as Partial<Item> & { itemType: string });

    const result = itemToTemplateData(item);

    expect(result.citationKey).toBe("smith2024");
    expect(result.citekey).toBe("smith2024");
  });
});
