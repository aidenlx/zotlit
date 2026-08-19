// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { makeItem } from "@zotlit/item-lookup/fixtures";

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

  it("falls back to My Library for the unnamed personal library", () => {
    expect(
      libraryText({
        selector: { type: "personal" },
        libraryID: 1,
        name: null,
      }),
    ).toBe("My Library");
  });
});

/** The rendered library row's text, or `null` when no such row was rendered. */
function libraryText(library: AvailableLibrary | null): string | null {
  const el = document.createElement("div");
  renderSuggestion(settings, hit(library), el);
  return el.querySelector(".library")?.textContent ?? null;
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
