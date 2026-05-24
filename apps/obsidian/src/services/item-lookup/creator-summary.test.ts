import { describe, expect, it } from "vitest";

import { type Creator } from "@zotlit/db";
import { makeItem } from "@zotlit/item-lookup/fixtures";

import { creatorSummary } from "./creator-summary";

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
