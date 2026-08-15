import type { App, Modifier } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { InsertCitationModal } from "./insert-modal";
import type { CitationSuggestDeps } from "./register";

function makeModal(): InsertCitationModal {
  const deps = {
    app: {} as App,
    lookup: { search: vi.fn().mockReturnValue([]) },
    noteFeature: { renderCitation: vi.fn() },
    settings: { current: {} },
  } as unknown as CitationSuggestDeps;
  return new InsertCitationModal(deps, {} as never);
}

/**
 * Regression for discussion #644: the modal advertises `⇧↵` for the secondary
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
