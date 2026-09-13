import { describe, expect, it, onTestFinished } from "vitest";

import { isChildItemFields } from "@zotlit/db";
import type { Creator, ItemDisplayInfo } from "@zotlit/db";
import { makeItem } from "@zotlit/item-lookup/fixtures";

import { runtime } from "./i18n/generated/runtime";
import { itemSummary, creatorSummary, workLabel } from "./item-summary";

function creator(
  firstName: string | null,
  lastName: string | null,
  creatorType = "author",
): Creator {
  return { firstName, lastName, creatorType, fieldMode: 0 };
}

function organization(lastName: string, creatorType = "author"): Creator {
  return { firstName: null, lastName, creatorType, fieldMode: 1 };
}

describe("itemSummary", () => {
  it("formats the primary author, year, and title", () => {
    const item = makeItem({
      key: "A",
      title: "Reported book",
      date: "2007",
      creators: [
        creator(null, "Bianca"),
        creator(null, "Translator One", "translator"),
        creator(null, "Translator Two", "translator"),
      ],
      primaryCreatorType: "author",
    });

    if (isChildItemFields(item.fields)) throw new Error("Expected Item fields");
    expect(itemSummary(item, item.fields)).toEqual({
      title: "Reported book",
      subtitle: "Bianca (2007)",
      formatted: "Bianca (2007): Reported book",
    });
  });

  it("uses the citation key when the item has no title", () => {
    const item = makeItem({
      key: "A",
      title: null,
      citationKey: "bianca2007",
      creators: [creator(null, "Bianca")],
      primaryCreatorType: "author",
    });

    if (isChildItemFields(item.fields)) throw new Error("Expected Item fields");
    expect(itemSummary(item, item.fields)).toEqual({
      title: "bianca2007",
      subtitle: "Bianca",
      formatted: "Bianca: bianca2007",
    });
  });

  it("formats lightweight display info with creator roles", () => {
    const item: ItemDisplayInfo = {
      key: "A",
      fields: {
        title: "Reported book",
        citationKey: null,
        date: "2007",
      },
      creators: [
        creator(null, "Bianca"),
        creator(null, "Translator One", "translator"),
        creator(null, "Translator Two", "translator"),
      ],
      primaryCreatorType: "author",
    };

    expect(itemSummary(item, item.fields)).toEqual({
      title: "Reported book",
      subtitle: "Bianca (2007)",
      formatted: "Bianca (2007): Reported book",
    });
  });

  it("uses the title as formatted text when the subtitle is empty", () => {
    const item: ItemDisplayInfo = {
      key: "A",
      fields: {
        title: "Reported book",
        citationKey: null,
        date: null,
      },
      creators: [],
      primaryCreatorType: "author",
    };

    expect(itemSummary(item, item.fields).formatted).toBe("Reported book");
  });
});

describe("workLabel", () => {
  it.each([
    {
      name: "single author",
      creators: [creator("Ada", "Smith")],
      fields: { title: "Full title", date: "2020-03-04" },
      expected: { byline: "Smith 2020", title: "Full title" },
    },
    {
      name: "two authors",
      creators: [creator("Ada", "Smith"), creator("Grace", "Jones")],
      fields: { title: "Full title", date: "2020" },
      expected: { byline: "Smith and Jones 2020", title: "Full title" },
    },
    {
      name: "three authors",
      creators: [
        creator("Ada", "Smith"),
        creator("Grace", "Jones"),
        creator("Lin", "Chen"),
      ],
      fields: { title: "Full title", date: "2020" },
      expected: { byline: "Smith et al. 2020", title: "Full title" },
    },
    {
      name: "organization",
      creators: [organization("World Health Organization")],
      fields: { title: "Full title", date: "2020" },
      expected: {
        byline: "World Health Organization 2020",
        title: "Full title",
      },
    },
    {
      name: "short title",
      creators: [creator("Ada", "Smith")],
      fields: { title: "Full title", shortTitle: "Short title", date: "2020" },
      expected: { byline: "Smith 2020", title: "Short title" },
    },
    {
      name: "empty short title",
      creators: [creator("Ada", "Smith")],
      fields: { title: "Full title", shortTitle: "  ", date: "2020" },
      expected: { byline: "Smith 2020", title: "Full title" },
    },
    {
      name: "missing creators",
      creators: [],
      fields: { title: "Full title", date: "2020" },
      expected: { byline: "Full title", title: "2020" },
    },
    {
      name: "short title without creators",
      creators: [],
      fields: { title: "Full title", shortTitle: "Short title", date: "2020" },
      expected: { byline: "Short title", title: "2020" },
    },
    {
      name: "missing year",
      creators: [creator("Ada", "Smith")],
      fields: { title: "Full title", date: null },
      expected: { byline: "Smith", title: "Full title" },
    },
    {
      name: "unreadable year",
      creators: [creator("Ada", "Smith")],
      fields: { title: "Full title", date: "forthcoming" },
      expected: { byline: "Smith", title: "Full title" },
    },
    {
      name: "missing title",
      creators: [creator("Ada", "Smith")],
      fields: { title: null, date: "2020" },
      expected: { byline: "Smith 2020", title: "" },
    },
    {
      name: "title alone",
      creators: [],
      fields: { title: "Full title" },
      expected: { byline: "Full title", title: "" },
    },
    {
      name: "author alone",
      creators: [creator("Ada", "Smith")],
      fields: {},
      expected: { byline: "Smith", title: "" },
    },
    {
      name: "year alone",
      creators: [],
      fields: { date: "2020" },
      expected: null,
    },
    {
      name: "no readable text",
      creators: [],
      fields: {},
      expected: null,
    },
  ])("formats $name", ({ creators, fields, expected }) => {
    expect(
      workLabel({ creators, primaryCreatorType: "author" }, fields),
    ).toEqual(expected);
  });

  it("returns no label for an unreadable item", () => {
    expect(workLabel(null)).toBeNull();
    expect(workLabel(undefined)).toBeNull();
  });

  it("uses the zh-CN author summary and list joining", () => {
    using stack = new DisposableStack();
    stack.defer(() => runtime.reset());
    runtime.install({
      schemaVersion: 1,
      locale: "zh-CN",
      messages: {
        creator_summary: {
          declarations: [
            { type: "input", name: "count" },
            { type: "input", name: "first" },
          ],
          variants: [
            {
              matches: [{ type: "literal", key: "count", value: "1" }],
              pattern: [{ type: "variable", name: "first" }],
            },
            {
              matches: [{ type: "catchall", key: "count" }],
              pattern: [
                { type: "variable", name: "first" },
                { type: "text", value: "等" },
              ],
            },
          ],
        },
      },
    });
    const fields = { title: "中文标题", date: "2020" };
    expect(
      workLabel(
        {
          creators: [creator("明", "王"), creator("华", "李")],
          primaryCreatorType: "author",
        },
        fields,
      ),
    ).toEqual({ byline: "王和李 2020", title: "中文标题" });
    expect(
      workLabel(
        {
          creators: [
            creator("明", "王"),
            creator("华", "李"),
            creator("兰", "陈"),
          ],
          primaryCreatorType: "author",
        },
        fields,
      ),
    ).toEqual({ byline: "王等 2020", title: "中文标题" });
  });
});

describe("creatorSummary", () => {
  it("returns '' when no creators are available", () => {
    expect(
      creatorSummary(
        makeItem({
          key: "A",
          creators: [],
          primaryCreatorType: "author",
        }),
      ),
    ).toBe("");
  });

  it("returns the single primary creator's lastName", () => {
    expect(
      creatorSummary(
        makeItem({
          key: "A",
          itemType: "journalArticle",
          creators: [creator("Ada", "Lovelace")],
          primaryCreatorType: "author",
        }),
      ),
    ).toBe("Lovelace");
  });

  it("joins two primary creators with the locale's list pattern", () => {
    expect(
      creatorSummary(
        makeItem({
          key: "A",
          itemType: "journalArticle",
          creators: [creator("Ada", "Lovelace"), creator("Grace", "Hopper")],
          primaryCreatorType: "author",
        }),
      ),
    ).toBe("Lovelace and Hopper");
  });

  it("joins two primary creators in the locale the messages render in", () => {
    // A pack that translates nothing still names the locale every message
    // renders in, which is the locale the pair joins by.
    runtime.install({ schemaVersion: 1, locale: "zh-CN", messages: {} });
    onTestFinished(() => runtime.reset());

    expect(
      creatorSummary(
        makeItem({
          key: "A",
          itemType: "journalArticle",
          creators: [creator("Ada", "Lovelace"), creator("Grace", "Hopper")],
          primaryCreatorType: "author",
        }),
      ),
    ).toBe("Lovelace和Hopper");
  });

  it("appends et al. for three or more primary creators", () => {
    expect(
      creatorSummary(
        makeItem({
          key: "A",
          itemType: "journalArticle",
          creators: [
            creator("Ada", "Lovelace"),
            creator("Grace", "Hopper"),
            creator("Margaret", "Hamilton"),
          ],
          primaryCreatorType: "author",
        }),
      ),
    ).toBe("Lovelace et al.");
  });

  it("uses et al. for two creators when the second lastName is unusable", () => {
    expect(
      creatorSummary(
        makeItem({
          key: "A",
          creators: [creator("Ada", "Lovelace"), creator(null, null)],
          primaryCreatorType: "author",
        }),
      ),
    ).toBe("Lovelace et al.");
  });

  it("returns '' for translator-only books", () => {
    expect(
      creatorSummary(
        makeItem({
          key: "A",
          creators: [creator("Donald", "Keene", "translator")],
          primaryCreatorType: "author",
        }),
      ),
    ).toBe("");
  });

  it("falls back to editor before translator", () => {
    expect(
      creatorSummary(
        makeItem({
          key: "A",
          creators: [
            creator("Donald", "Keene", "translator"),
            creator("Robin", "Davis", "editor"),
          ],
          primaryCreatorType: "author",
        }),
      ),
    ).toBe("Davis");
  });

  it("falls back to editor when the primary creator type has no matches", () => {
    expect(
      creatorSummary(
        makeItem({
          key: "A",
          creators: [creator("Robin", "Davis", "editor")],
          primaryCreatorType: "author",
        }),
      ),
    ).toBe("Davis");
  });

  it("falls back to director before contributor", () => {
    expect(
      creatorSummary(
        makeItem({
          key: "A",
          creators: [
            creator("Con", "Tribe", "contributor"),
            creator("Ruth", "Davis", "director"),
          ],
          primaryCreatorType: "author",
        }),
      ),
    ).toBe("Davis");
  });

  it("falls back to contributor", () => {
    expect(
      creatorSummary(
        makeItem({
          key: "A",
          creators: [creator("Con", "Tribe", "contributor")],
          primaryCreatorType: "author",
        }),
      ),
    ).toBe("Tribe");
  });

  it("uses organization literals from the lastName slot", () => {
    expect(
      creatorSummary(
        makeItem({
          key: "A",
          creators: [organization("The Royal Society")],
          primaryCreatorType: "author",
        }),
      ),
    ).toBe("The Royal Society");
  });

  it("starts with editor when primaryCreatorType is null", () => {
    expect(
      creatorSummary(
        makeItem({
          key: "A",
          creators: [
            creator("Donald", "Keene", "translator"),
            creator("Robin", "Davis", "editor"),
          ],
          primaryCreatorType: null,
        }),
      ),
    ).toBe("Davis");
  });

  it("returns '' when the chosen bucket's first creator has no lastName", () => {
    expect(
      creatorSummary(
        makeItem({
          key: "A",
          creators: [creator("Ada", null), creator("Robin", "Davis", "editor")],
          primaryCreatorType: "author",
        }),
      ),
    ).toBe("");
  });
});
