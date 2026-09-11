// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { makeCreator, makeItem } from "@zotlit/item-lookup/fixtures";
import type {
  ItemFixtureOptions,
  TypedItemFixtureOptions,
} from "@zotlit/item-lookup/fixtures";
import type { ItemFields } from "@zotlit/zotero-types";

import type { AvailableLibrary } from "@/services/library-scope/scope";
import type { SettingsService } from "@/services/settings/service";

import { renderSuggestion } from "./render-hit";
import type { SearchHit } from "./service";

const settings = { current: {} } as unknown as SettingsService;

describe("renderSuggestion library label", () => {
  it("names the library a result came from", () => {
    expect(libraryText(group(100, "Shared A"))).toBe("Shared A");
  });

  it("omits the label when one library can contribute", () => {
    expect(libraryText(null)).toBeNull();
  });

  it("omits the label for My Library, the implicit source", () => {
    expect(
      libraryText({
        selector: { type: "personal" },
        libraryID: 1,
        name: null,
      }),
    ).toBeNull();
  });
});

/** The aux-slot library label's text, or `null` when no label was rendered. */
function libraryText(library: AvailableLibrary | null): string | null {
  const el = document.createElement("div");
  renderSuggestion(settings, hit(library), el);
  return el.querySelector(".suggestion-aux .library")?.textContent ?? null;
}

function hit(library: AvailableLibrary | null): SearchHit {
  return {
    item: makeItem({ key: "AAAAAAAA", title: "Alpha" }),
    score: 1,
    matches: [],
    library,
  };
}

function group(groupID: number, name: string): AvailableLibrary {
  return { selector: { type: "group", groupID }, libraryID: groupID, name };
}

describe("renderSuggestion result meta line", () => {
  const authored = {
    date: "2023-05-01",
    primaryCreatorType: "author",
    creators: [makeCreator("Lin", "Ye"), makeCreator("Xin", "Wei")],
  } satisfies Partial<ItemFixtureOptions>;

  it("shows author summary, year, Venue, volume, issue, and pages for a journal article", () => {
    expect(
      metaParts({
        key: "AAAAAAAA",
        itemType: "journalArticle",
        title: "Alpha",
        ...authored,
        publicationTitle: "Journal of Personal Records",
        volume: "12",
        issue: "3",
        pages: "1-20",
      }),
    ).toEqual({
      authorYear: "Ye and Wei (2023)",
      publication: "Journal of Personal Records",
      volume: "12",
      issue: "3",
      pages: "1-20",
    });
  });

  it("shows the author summary and year for a preprint", () => {
    expect(
      metaParts({
        key: "BBBB2222",
        itemType: "preprint",
        title: "Beta",
        ...authored,
      })?.authorYear,
    ).toBe("Ye and Wei (2023)");
  });

  it("shows a container-role Venue: a book section's book title", () => {
    expect(
      metaParts({
        key: "CCCC3333",
        itemType: "bookSection",
        title: "Gamma",
        ...authored,
        fields: { bookTitle: "Collected Personal Essays" },
      })?.publication,
    ).toBe("Collected Personal Essays");
  });

  it("shows a publisher-role Venue: a preprint's repository", () => {
    expect(
      metaParts({
        key: "DDDD4444",
        itemType: "preprint",
        title: "Delta",
        ...authored,
        fields: { repository: "arXiv" },
      })?.publication,
    ).toBe("arXiv");
  });

  it("shows volume, issue, and pages for an item type that records them", () => {
    expect(
      metaParts({
        key: "EEEE5555",
        itemType: "magazineArticle",
        title: "Epsilon",
        ...authored,
        fields: { volume: "7", issue: "2", pages: "44-49" },
      }),
    ).toMatchObject({ volume: "7", issue: "2", pages: "44-49" });
  });

  it("renders no meta line for an item with no creators, date, or Venue", () => {
    expect(
      metaParts({ key: "FFFF6666", itemType: "letter", title: "Zeta" }),
    ).toBeNull();
  });
});

/** `null` where the row rendered no meta line at all. */
function metaParts<TType extends ItemFields["itemType"]>(
  options: TypedItemFixtureOptions<TType>,
): Record<string, string> | null {
  const el = document.createElement("div");
  renderSuggestion(
    settings,
    { item: makeItem(options), score: 1, matches: [], library: null },
    el,
  );
  const metaEl = el.querySelector(".meta");
  if (!metaEl) return null;
  return Object.fromEntries(
    (
      [
        ["authorYear", ".author-year"],
        ["publication", ".publication"],
        ["volume", ".volume"],
        ["issue", ".issue"],
        ["pages", ".pages"],
      ] as const
    ).flatMap(([name, selector]) => {
      const text = metaEl.querySelector(selector)?.textContent;
      return text ? [[name, text]] : [];
    }),
  );
}
