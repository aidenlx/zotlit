import type { App, Editor, Modifier } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { lookupAnswer } from "@/services/citation-index/__fixtures__/lookup";
import type { CitekeyResolution } from "@/services/citation-index/service";
import type { SearchHit } from "@/services/item-lookup/service";

import { InsertCitationModal } from "./insert-modal";
import type { CitationSuggestDeps } from "./register";

function makeModal(
  overrides: Partial<CitationSuggestDeps> = {},
  editor: Editor = {} as Editor,
): InsertCitationModal {
  const deps = {
    app: {} as App,
    lookup: { openSession: vi.fn() },
    noteFeature: { renderCitation: vi.fn() },
    settings: { current: {} },
    citationIndex: {
      readLookup: async () => lookupAnswer(),
      resolution: "fresh",
    },
    ...overrides,
  } as unknown as CitationSuggestDeps;
  return new InsertCitationModal(deps, editor);
}

/**
 * Regression for discussion #644: the modal advertises `⇧↵` for the alternate
 * citation, but Obsidian's suggestion popup registers `Enter` with no
 * modifiers and matches them exactly, so Shift+Enter reached no handler at all
 * and the modal just sat there. The modal has to register the chord itself.
 */
describe("InsertCitationModal keymap", () => {
  function findShiftEnter(
    modal: InsertCitationModal,
  ): ((evt: KeyboardEvent) => boolean | void) | undefined {
    const scope = modal.scope as unknown as {
      handlers: {
        modifiers: Modifier[] | null;
        key: string | null;
        func: (evt: KeyboardEvent) => boolean | void;
      }[];
    };
    return scope.handlers.find(
      (h) => h.key === "Enter" && h.modifiers?.includes("Shift"),
    )?.func;
  }

  it("registers a Shift+Enter handler", () => {
    expect(findShiftEnter(makeModal())).toBeDefined();
  });

  it("selects the highlighted suggestion when Shift+Enter fires", () => {
    const modal = makeModal();
    const select = vi
      .spyOn(modal, "selectActiveSuggestion")
      .mockImplementation(() => {});
    const evt = { shiftKey: true } as KeyboardEvent;

    const result = findShiftEnter(modal)?.(evt);

    expect(select).toHaveBeenCalledWith(evt);
    // Returning false tells Obsidian the chord was consumed, so the keypress
    // does not fall through to the default Enter handling.
    expect(result).toBe(false);
  });
});

describe("InsertCitationModal ambiguity", () => {
  it("writes nothing into the note when the Citation Key names several Items", async () => {
    const ambiguous: CitekeyResolution = {
      kind: "ambiguous",
      candidates: [
        { itemID: 1, libraryID: 1, key: "DOE2024", indexedKey: "DOE2024" },
        { itemID: 2, libraryID: 4, key: "ROE2025", indexedKey: "ROE2025g7" },
      ],
    };
    const renderCitation = vi.fn();
    const replaceRange = vi.fn();
    const editor = {
      getValue: () => "",
      getCursor: () => ({ line: 0, ch: 0 }),
      getLine: () => "",
      replaceRange,
      setCursor: vi.fn(),
      offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
      posToOffset: () => 0,
    } as unknown as Editor;
    const modal = makeModal(
      {
        noteFeature: { renderCitation },
        citationIndex: {
          readLookup: async () => lookupAnswer({ doe2024: ambiguous }),
          resolution: "fresh",
        },
      } as unknown as Partial<CitationSuggestDeps>,
      editor,
    );
    const hit = {
      item: { key: "ABC123", fields: { citationKey: "doe2024" } },
      matches: [],
    } as unknown as SearchHit;

    await modal.onChooseSuggestion(hit, {} as MouseEvent);

    expect(renderCitation).not.toHaveBeenCalled();
    expect(replaceRange).not.toHaveBeenCalled();
  });
});
