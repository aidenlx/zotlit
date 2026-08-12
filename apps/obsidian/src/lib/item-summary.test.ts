import { describe, expect, it } from "vitest";

import { isChildItemFields } from "@zotlit/db";
import type { Creator, ItemDisplayInfo } from "@zotlit/db";
import { makeItem } from "@zotlit/item-lookup/fixtures";

import { itemSummary, creatorSummary } from "./item-summary";

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

  it("joins two primary creators with isolated lastName values", () => {
    expect(
      creatorSummary(
        makeItem({
          key: "A",
          itemType: "journalArticle",
          creators: [creator("Ada", "Lovelace"), creator("Grace", "Hopper")],
          primaryCreatorType: "author",
        }),
      ),
    ).toBe("⁨Lovelace⁩ and ⁨Hopper⁩");
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
