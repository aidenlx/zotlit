// A filter over Items held in memory: each form a stored Profile Match
// holds keeps its meaning, and a mistake gives the Diagnostic a query gives.
import { describe, expect, it } from "vitest";

import { planItemFilter, queryItemFrom, testItemSeed } from "./index";
import type { ItemFilter, QueryItemSeed } from "./index";

const SEED: QueryItemSeed = {
  scan: {
    itemID: 7,
    key: "ABCD2345",
    itemType: "book",
    dateAdded: Temporal.Instant.from("2024-03-01T00:00:00Z").epochMilliseconds,
    dateModified: null,
  },
  groupID: 5,
  fields: { title: "Thinking, fast and slow", date: "2011-00-00 2011" },
  custom: {},
  customFieldNames: [],
  creators: [
    {
      firstName: "Daniel",
      lastName: "Kahneman",
      fieldMode: 0,
      creatorType: "author",
      primary: true,
    },
  ],
  tags: [
    { name: "psychology", type: 0 },
    { name: "to-read", type: 1 },
  ],
  collections: [["Reading", "Cognition"]],
};

const item = queryItemFrom(SEED);

function plan(text: string): ItemFilter {
  const planned = planItemFilter(text);
  if (!("matches" in planned)) throw new Error(planned.message);
  return planned;
}

describe("planItemFilter", () => {
  it.each<[string, boolean]>([
    ['library == "group:5"', true],
    ['library != "personal"', true],
    ['itemType == "book"', true],
    ['itemType != "book"', false],
    ['tags.contains("to-read")', true],
    ['tags.containsAny("history", "psychology")', true],
    ['tags.containsAll("history", "psychology")', false],
    ["tags.isEmpty()", false],
    ['!tags.contains("history")', true],
    ['collections.within("Reading")', true],
    ['collections.contains("Reading/Cognition")', true],
    ['collections.contains("Reading")', false],
    ["collections.isEmpty()", false],
    ["true", true],
    ["!true", false],
    ['!((itemType == "book") || (library == "personal"))', false],
    ['title.contains("fast")', true],
    ['creators.containsAny("Daniel Kahneman")', true],
  ])("reads %s as %s", (text, expected) => {
    expect(plan(text).matches(item)).toBe(expected);
  });

  it("finds no Attachment on an Item from a seed", () => {
    expect(plan("attachments.isEmpty()").matches(item)).toBe(true);
  });

  it("reads dates on the clock it is given", () => {
    const filter = plan('date(dateAdded) == today() - duration("1d")');
    const on = (iso: string) => ({
      now: Temporal.Instant.from(iso),
      timeZone: "UTC",
    });
    expect(filter.matches(item, on("2024-03-02T12:00:00Z"))).toBe(true);
    expect(filter.matches(item, on("2024-03-05T12:00:00Z"))).toBe(false);
  });

  it("reads a name it does not know as a custom field with no value", () => {
    expect(plan('itemTpye == "book"').matches(item)).toBe(false);
  });

  it.each([
    ["a syntax mistake", 'itemType == "book" &&'],
    ["an unknown method", 'tags.contain("to-read")'],
  ])("gives the Diagnostic of %s", (_, text) => {
    const planned = planItemFilter(text);
    expect("matches" in planned).toBe(false);
    expect(planned).toMatchObject({ severity: "error" });
  });

  it("names the method it means in the Diagnostic of a misspelt one", () => {
    const planned = planItemFilter('tags.contain("to-read")');
    expect("suggestions" in planned && planned.suggestions).toContain(
      "contains",
    );
  });
});

describe("testItemSeed", () => {
  it("answers a filter as a query of the Item answers it", () => {
    expect(testItemSeed('itemType == "book"', SEED)).toEqual({
      kind: "result",
      matched: true,
    });
    expect(testItemSeed('tags.contains("history")', SEED)).toEqual({
      kind: "result",
      matched: false,
    });
  });

  it("refuses a custom field that the source of the Item lacks", () => {
    const answer = testItemSeed("shelfMark == null", SEED);
    expect(answer).toMatchObject({
      kind: "problem",
      diagnostic: { severity: "error" },
    });
    expect(
      testItemSeed("shelfMark == null", {
        ...SEED,
        customFieldNames: ["shelfMark"],
      }),
    ).toEqual({ kind: "result", matched: true });
  });

  it.each([
    "attachments.length > 0",
    "annotations.isEmpty()",
    "notes.isEmpty()",
  ])(
    "has no answer for %s, which reads records a seed does not keep",
    (text) => {
      expect(testItemSeed(text, SEED)).toEqual({ kind: "unavailable" });
    },
  );

  it("gives the Diagnostic of a mistake", () => {
    expect(testItemSeed('tags.contain("to-read")', SEED)).toMatchObject({
      kind: "problem",
    });
  });
});
