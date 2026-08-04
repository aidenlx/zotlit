// ZotLit-specific mapper behavior. Agreement with Zotero across the whole
// regular-item schema lives in the golden corpus, `zt-csl-item.corpus.test.ts`.
import { describe, expect, it } from "vitest";

import { Temporal } from "@zotlit/shared/temporal";
import { type ItemFields } from "@zotlit/zotero-types";

import { USER_LIBRARY_ID } from "@/lib/constants";
import { type Creator, type Item } from "@/queries/items";

import { itemToCsl } from "./zt-csl-item";

/** A synced personal account; every fixture item belongs to its library. */
const USER = {
  userID: 475425,
  localUserKey: "v3aG8nQf",
  username: "aidenlx",
};

/** The Item URI `makeItem`'s default key resolves to under {@link USER}. */
const URI = "http://zotero.org/users/475425/items/ABC12345";

function makeItem(
  fields: { itemType: string } & Record<string, string | null>,
  base?: Partial<Omit<Item, "fields">>,
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

function creator(
  creatorType: string,
  lastName: string | null,
  opts?: { firstName?: string; fieldMode?: Creator["fieldMode"] },
): Creator {
  return {
    creatorType,
    lastName,
    firstName: opts?.firstName ?? null,
    fieldMode: opts?.fieldMode ?? 0,
  };
}

describe("itemToCsl: identity and type", () => {
  it("keys the CSL item by its Zotero Item URI", () => {
    expect(itemToCsl(makeItem({ itemType: "book" }), USER).id).toBe(URI);
  });

  it("keys a group item by the group Item URI", () => {
    const item = makeItem(
      { itemType: "book" },
      { key: "KX67D9YM", indexedKey: "KX67D9YMg12345", groupID: 12345 },
    );
    expect(itemToCsl(item, USER).id).toBe(
      "http://zotero.org/groups/12345/items/KX67D9YM",
    );
  });

  it("keys a never-synced personal item by the local Item URI", () => {
    const item = makeItem({ itemType: "book" });
    expect(
      itemToCsl(item, {
        userID: null,
        localUserKey: "v3aG8nQf",
        username: null,
      }).id,
    ).toBe("http://zotero.org/users/local/v3aG8nQf/items/ABC12345");
  });

  it("falls back to the Indexed Key when the account carries no id", () => {
    const item = makeItem({ itemType: "book" });
    expect(
      itemToCsl(item, { userID: null, localUserKey: null, username: null }).id,
    ).toBe("ABC12345");
  });

  it("rejects an item type outside the CSL mapping", () => {
    expect(() => itemToCsl(makeItem({ itemType: "annotation" }), USER)).toThrow(
      'Unexpected Zotero Item type "annotation"',
    );
  });
});

describe("itemToCsl: text variables", () => {
  it("falls back past an empty earlier field candidate", () => {
    const csl = itemToCsl(
      makeItem({
        itemType: "journalArticle",
        seriesTitle: "",
        series: "Series B",
      }),
      USER,
    );
    expect(csl["collection-title"]).toBe("Series B");
  });

  it("keeps only the first ISBN", () => {
    const isbn = (value: string): unknown =>
      itemToCsl(makeItem({ itemType: "book", ISBN: value }), USER).ISBN;
    expect(isbn("978-0-19-953556-9 0-19-953556-1")).toBe("978-0-19-953556-9");
    expect(isbn("0-19-953556-1 978-0-19-953556-9")).toBe("0-19-953556-1");
    expect(isbn("019953556x")).toBe("019953556x");
  });

  it("keeps an ISBN field that holds no recognizable ISBN", () => {
    const csl = itemToCsl(
      makeItem({ itemType: "book", ISBN: "forthcoming" }),
      USER,
    );
    expect(csl.ISBN).toBe("forthcoming");
  });

  it("strips enclosing quotes from a value", () => {
    const csl = itemToCsl(
      makeItem({ itemType: "book", title: '"Quoted Title"' }),
      USER,
    );
    expect(csl.title).toBe("Quoted Title");
  });

  it("keeps quotes that do not enclose the whole value", () => {
    const title = (value: string): unknown =>
      itemToCsl(makeItem({ itemType: "book", title: value }), USER).title;
    expect(title('"Quoted" Title"')).toBe('"Quoted" Title"');
    expect(title('He said "hi"')).toBe('He said "hi"');
  });

  it("omits empty and absent fields", () => {
    const csl = itemToCsl(
      makeItem({ itemType: "book", title: "", publisher: null }),
      USER,
    );
    expect(csl).toEqual({ id: URI, type: "book" });
  });

  it("reads a custom field a built-in field does not cover", () => {
    const csl = itemToCsl(
      makeItem(
        { itemType: "book" },
        {
          customFields: new Map([["citationKey", "smith2024"]]),
        },
      ),
      USER,
    );
    expect(csl["citation-key"]).toBe("smith2024");
  });

  it("normalizes Extra cheater syntax on its way to the note variable", () => {
    const csl = itemToCsl(
      makeItem({
        itemType: "book",
        extra: "Publication Title: Replacement title\ndoi: 10.1234/example",
      }),
      USER,
    );
    expect(csl.note).toBe(
      "container-title: Replacement title\nDOI: 10.1234/example",
    );
  });
});

describe("itemToCsl: name variables", () => {
  it("splits creator particles and suffixes into CSL name parts", () => {
    const csl = itemToCsl(
      makeItem(
        { itemType: "book" },
        {
          creators: [
            creator("author", "la Fontaine", { firstName: "Jean de, Jr." }),
            creator("author", '"van Gogh"', { firstName: "Vincent de" }),
          ],
        },
      ),
      USER,
    );
    expect(csl.author).toEqual([
      {
        family: "Fontaine",
        given: "Jean",
        "non-dropping-particle": "la",
        "dropping-particle": "de",
        suffix: "Jr.",
      },
      { family: "van Gogh", given: "Vincent de" },
    ]);
  });
});

describe("itemToCsl: date variables", () => {
  it("maps a year-month date to a date-parts pair", () => {
    const csl = itemToCsl(
      makeItem({ itemType: "book", date: "2024-06-00 June 2024" }),
      USER,
    );
    expect(csl.issued).toEqual({ "date-parts": [[2024, 6]] });
  });

  it("maps a year-only date to a date-parts singleton", () => {
    const csl = itemToCsl(
      makeItem({ itemType: "book", date: "2003-00-00 2003" }),
      USER,
    );
    expect(csl.issued).toEqual({ "date-parts": [[2003]] });
  });

  it("maps an unparseable date to a literal", () => {
    const csl = itemToCsl(
      makeItem({ itemType: "book", date: "0000-00-00 in press" }),
      USER,
    );
    expect(csl.issued).toEqual({ literal: "in press" });
  });

  it("keeps the month and day of an access date stored as a bare SQL date", () => {
    const csl = itemToCsl(
      makeItem({ itemType: "webpage", accessDate: "2024-03-01" }),
      USER,
    );
    expect(csl.accessed).toEqual({ "date-parts": [[2024, 3, 1]] });
  });

  it("converts timestamp access dates to the local calendar day", () => {
    const raw = "2024-03-01T00:30:00Z";
    const local = Temporal.Instant.from(raw)
      .toZonedDateTimeISO(Temporal.Now.timeZoneId())
      .toPlainDate();
    const csl = itemToCsl(
      makeItem({ itemType: "webpage", accessDate: raw }),
      USER,
    );
    expect(csl.accessed).toEqual({
      "date-parts": [[local.year, local.month, local.day]],
    });
  });

  it("preserves year-only date qualifiers as CSL seasons", () => {
    const issued = (date: string): unknown =>
      itemToCsl(makeItem({ itemType: "book", date }), USER).issued;
    expect(issued("1999-00-00 circa 1999")).toEqual({
      "date-parts": [[1999]],
      season: "circa",
    });
    expect(issued("circa 1999")).toEqual({
      "date-parts": [[1999]],
      season: "circa",
    });
    expect(issued("1999-00-00 Summer 1999")).toEqual({
      "date-parts": [[1999]],
      season: "Summer",
    });
    expect(issued("2014-00-00 2014")).toEqual({ "date-parts": [[2014]] });
    expect(issued("2003-00-01 01 2003")).toEqual({ "date-parts": [[2003]] });
    expect(issued("2013-01-00 January 2013")).toEqual({
      "date-parts": [[2013, 1]],
    });
  });
});
