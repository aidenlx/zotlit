import { type App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ItemLookup,
  type SearchHit,
} from "@/services/item-lookup/service";
import { type NoteFeature } from "@/services/note-feature";
import { type SettingsService } from "@/services/settings/service";
import { InertTemplateError } from "@/services/template/errors";

import { CitationEditorSuggest } from "./editor-suggest";
import { type CitationSuggestDeps } from "./register";

const noticeCalls: string[] = [];
vi.mock("@/lib/notice", () => ({
  BaseNotice: class {
    constructor(message: string) {
      noticeCalls.push(message);
    }
  },
}));

beforeEach(() => {
  noticeCalls.length = 0;
});

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

    const hit = makeHit("abc2024");
    suggest.selectSuggestion(hit, {} as KeyboardEvent);

    expect(renderCitation).toHaveBeenCalledWith(
      [{ citationKey: "abc2024", item: hit.item }],
      false,
    );
    expect(replaceRange).not.toHaveBeenCalled();
  });

  it("surfaces an inert-template error's own message as a notice instead of throwing", () => {
    const replaceRange = vi.fn();
    const renderCitation = vi.fn(() => {
      throw new InertTemplateError("cite template is inert");
    });
    const deps: CitationSuggestDeps = {
      app: {} as App,
      lookup: {} as ItemLookup,
      noteFeature: { renderCitation } as unknown as Pick<
        NoteFeature,
        "renderCitation"
      >,
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

    expect(() =>
      suggest.selectSuggestion(makeHit("abc2024"), {} as KeyboardEvent),
    ).not.toThrow();
    expect(noticeCalls).toEqual(["cite template is inert"]);
    expect(replaceRange).not.toHaveBeenCalled();
  });
});
