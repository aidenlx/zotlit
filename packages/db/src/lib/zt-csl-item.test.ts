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

  it("maps a Zotero item type to its CSL type", () => {
    expect(itemToCsl(makeItem({ itemType: "journalArticle" }), USER).type).toBe(
      "article-journal",
    );
    expect(itemToCsl(makeItem({ itemType: "bookSection" }), USER).type).toBe(
      "chapter",
    );
    expect(
      itemToCsl(makeItem({ itemType: "conferencePaper" }), USER).type,
    ).toBe("paper-conference");
  });

  it("maps item types beyond the first candidate of each CSL type", () => {
    expect(itemToCsl(makeItem({ itemType: "videoRecording" }), USER).type).toBe(
      "motion_picture",
    );
    expect(itemToCsl(makeItem({ itemType: "tvBroadcast" }), USER).type).toBe(
      "broadcast",
    );
    expect(itemToCsl(makeItem({ itemType: "email" }), USER).type).toBe(
      "personal_communication",
    );
  });

  it("rejects an item type outside the CSL mapping", () => {
    expect(() => itemToCsl(makeItem({ itemType: "annotation" }), USER)).toThrow(
      'Unexpected Zotero Item type "annotation"',
    );
  });
});

describe("itemToCsl: text variables", () => {
  it("maps the core journal-article fields", () => {
    const csl = itemToCsl(
      makeItem({
        itemType: "journalArticle",
        title: "A Study",
        abstractNote: "Lorem ipsum",
        publicationTitle: "Nature",
        volume: "42",
        issue: "3",
        pages: "100-110",
        language: "en-US",
      }),
      USER,
    );
    expect(csl).toMatchObject({
      title: "A Study",
      abstract: "Lorem ipsum",
      "container-title": "Nature",
      volume: "42",
      issue: "3",
      page: "100-110",
      language: "en-US",
    });
  });

  it("maps the identifier fields", () => {
    const csl = itemToCsl(
      makeItem({
        itemType: "journalArticle",
        DOI: "10.1234/test",
        ISSN: "0028-0836",
        url: "https://example.com/a",
        citationKey: "smith2024",
      }),
      USER,
    );
    expect(csl).toMatchObject({
      DOI: "10.1234/test",
      ISSN: "0028-0836",
      URL: "https://example.com/a",
      "citation-key": "smith2024",
    });
  });

  it("reads a type-specific field through its base field", () => {
    const csl = itemToCsl(
      makeItem({ itemType: "bookSection", bookTitle: "Handbook of Things" }),
      USER,
    );
    expect(csl["container-title"]).toBe("Handbook of Things");
  });

  it("falls back to a later field candidate", () => {
    expect(
      itemToCsl(
        makeItem({ itemType: "conferencePaper", conferenceName: "CHI 2024" }),
        USER,
      )["event-title"],
    ).toBe("CHI 2024");
    expect(
      itemToCsl(makeItem({ itemType: "case", reporter: "U.S." }), USER)[
        "container-title"
      ],
    ).toBe("U.S.");
  });

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

  it("reaches the third field candidate", () => {
    const csl = itemToCsl(
      makeItem({ itemType: "statute", code: "U.S. Code" }),
      USER,
    );
    expect(csl["container-title"]).toBe("U.S. Code");
  });

  it("prefers the earlier field candidate when both carry a value", () => {
    const csl = itemToCsl(
      makeItem({
        itemType: "journalArticle",
        seriesTitle: "Cognitive Science Series",
        series: "Series B",
      }),
      USER,
    );
    expect(csl["collection-title"]).toBe("Cognitive Science Series");
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

  it("writes the short title as title-short only", () => {
    const csl = itemToCsl(
      makeItem({ itemType: "book", shortTitle: "Study" }),
      USER,
    );
    expect(csl["title-short"]).toBe("Study");
    expect(csl).not.toHaveProperty("shortTitle");
  });

  it("maps place to event-place for the event-place item types", () => {
    const csl = itemToCsl(
      makeItem({ itemType: "presentation", place: "Honolulu" }),
      USER,
    );
    expect(csl["event-place"]).toBe("Honolulu");
    expect(csl).not.toHaveProperty("publisher-place");
  });

  it("maps place to publisher-place for every other item type", () => {
    const csl = itemToCsl(
      makeItem({ itemType: "book", place: "London" }),
      USER,
    );
    expect(csl["publisher-place"]).toBe("London");
    expect(csl).not.toHaveProperty("event-place");
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
});

describe("itemToCsl: name variables", () => {
  it("maps creator types to their CSL name variables, in Zotero's order", () => {
    const csl = itemToCsl(
      makeItem(
        { itemType: "book" },
        {
          creators: [
            creator("author", "Hensher", { firstName: "David" }),
            creator("author", "Rose", { firstName: "John" }),
            creator("editor", "Greene", { firstName: "William" }),
            creator("translator", "Li", { firstName: "Wei" }),
          ],
        },
      ),
      USER,
    );
    expect(csl.author).toEqual([
      { family: "Hensher", given: "David" },
      { family: "Rose", given: "John" },
    ]);
    expect(csl.editor).toEqual([{ family: "Greene", given: "William" }]);
    expect(csl.translator).toEqual([{ family: "Li", given: "Wei" }]);
  });

  it("maps a single-field creator to a literal name", () => {
    const csl = itemToCsl(
      makeItem(
        { itemType: "report" },
        {
          creators: [
            creator("author", "World Health Organization", { fieldMode: 1 }),
          ],
        },
      ),
      USER,
    );
    expect(csl.author).toEqual([{ literal: "World Health Organization" }]);
  });

  it("maps an unmapped primary creator type to author", () => {
    const csl = itemToCsl(
      makeItem(
        { itemType: "computerProgram" },
        {
          primaryCreatorType: "programmer",
          creators: [creator("programmer", "Torvalds", { firstName: "Linus" })],
        },
      ),
      USER,
    );
    expect(csl.author).toEqual([{ family: "Torvalds", given: "Linus" }]);
  });

  it("drops an unmapped non-primary creator type", () => {
    const csl = itemToCsl(
      makeItem(
        { itemType: "bill" },
        {
          primaryCreatorType: "sponsor",
          creators: [creator("cosponsor", "Doe", { firstName: "Jane" })],
        },
      ),
      USER,
    );
    expect(csl).toEqual({ id: URI, type: "bill" });
  });

  it("maps a mapped creator type by its own name variable, not author", () => {
    const csl = itemToCsl(
      makeItem(
        { itemType: "podcast" },
        {
          primaryCreatorType: "podcaster",
          creators: [creator("podcaster", "Gross", { firstName: "Terry" })],
        },
      ),
      USER,
    );
    expect(csl.host).toEqual([{ family: "Gross", given: "Terry" }]);
    expect(csl).not.toHaveProperty("author");
  });
});

describe("itemToCsl: date variables", () => {
  it("maps a full date to a year-month-day date-parts triple", () => {
    const csl = itemToCsl(
      makeItem({ itemType: "book", date: "2015-04-27 April 27, 2015" }),
      USER,
    );
    expect(csl.issued).toEqual({ "date-parts": [[2015, 4, 27]] });
  });

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

  it("maps the remaining CSL date variables", () => {
    const csl = itemToCsl(
      makeItem({
        itemType: "patent",
        accessDate: "2024-03-01 12:30:00",
        filingDate: "2019-11-05 November 5, 2019",
        originalDate: "1998-00-00 1998",
      }),
      USER,
    );
    expect(csl.accessed).toEqual({ "date-parts": [[2024, 3, 1]] });
    expect(csl.submitted).toEqual({ "date-parts": [[2019, 11, 5]] });
    expect(csl["original-date"]).toEqual({ "date-parts": [[1998]] });
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

  it("reads a type-specific date field through its base field", () => {
    const csl = itemToCsl(
      makeItem({ itemType: "case", dateDecided: "1954-05-17 May 17, 1954" }),
      USER,
    );
    expect(csl.issued).toEqual({ "date-parts": [[1954, 5, 17]] });
  });
});
