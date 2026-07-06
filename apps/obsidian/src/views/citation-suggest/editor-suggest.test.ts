import { type App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  type ItemLookup,
  type SearchHit,
} from "@/services/item-lookup/service";
import { type NoteFeature } from "@/services/note-feature";
import { type SettingsService } from "@/services/settings/service";

import { CitationEditorSuggest } from "./editor-suggest";
import { type CitationSuggestDeps } from "./register";

function makeHit(citationKey: string | null): SearchHit {
  return {
    item: { key: "ABC123", fields: { citationKey } },
    score: 0,
    matches: [],
  } as unknown as SearchHit;
}

describe("CitationEditorSuggest.selectSuggestion", () => {
  it("shows a notice and leaves the editor untouched when the template isn't loaded yet", () => {
    // Regression for the C3 readiness gap: renderCitation returns null instead
    // of throwing when `template.loaded` is false, so this handler (which
    // can't await) must handle that null with a notice rather than inserting
    // an empty string into the editor.
    const replaceRange = vi.fn();
    const renderCitation = vi.fn().mockReturnValue(null);
    const deps: CitationSuggestDeps = {
      app: {} as App,
      lookup: {} as ItemLookup,
      noteFeature: { renderCitation } as Pick<NoteFeature, "renderCitation">,
      settings: {} as SettingsService,
    };

    const suggest = new CitationEditorSuggest(deps);
    suggest.context = {
      start: { line: 0, ch: 0 },
      end: { line: 0, ch: 0 },
      query: "abc",
      file: {} as never,
      editor: { replaceRange } as never,
    };

    suggest.selectSuggestion(makeHit("abc2024"), {} as KeyboardEvent);

    expect(renderCitation).toHaveBeenCalledWith(
      [{ citationKey: "abc2024" }],
      false,
    );
    expect(replaceRange).not.toHaveBeenCalled();
  });
});
