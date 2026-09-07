// UI seam for an Ambiguous Citation Key: the picker that opens one candidate exactly.

import { SuggestModal } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { candidateRow } from "@/services/citation-index/ambiguity";
import type {
  AmbiguousCandidate,
  CandidateRow,
} from "@/services/citation-index/ambiguity";
import {
  LIBRARY_ROW_CLASS,
  appendLibraryBadge,
  appendLibraryFlair,
} from "@/services/item-lookup/render-hit";

import type { AmbiguousCitekey, CitekeyEditor } from "./service";

/** Whether a candidate row answers a typed filter, over the text it shows. */
export function candidateMatches(row: CandidateRow, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return true;
  return [row.summary, row.library ?? "", row.key].some((field) =>
    field.toLowerCase().includes(trimmed),
  );
}

class AmbiguousCitekeyModal extends SuggestModal<AmbiguousCandidate> {
  readonly #ambiguous: AmbiguousCitekey;
  readonly #choose: (candidate: AmbiguousCandidate) => void;

  constructor(
    app: App,
    ambiguous: AmbiguousCitekey,
    choose: (candidate: AmbiguousCandidate) => void,
  ) {
    super(app);
    this.#ambiguous = ambiguous;
    this.#choose = choose;
    this.setPlaceholder(
      m.citekey_ambiguous_placeholder({ citekey: ambiguous.citekey }),
    );
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_open_lit_note() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }

  override getSuggestions(query: string): AmbiguousCandidate[] {
    return this.#ambiguous.candidates.filter((candidate) =>
      candidateMatches(candidateRow(candidate), query),
    );
  }

  override renderSuggestion(
    candidate: AmbiguousCandidate,
    el: HTMLElement,
  ): void {
    const row = candidateRow(candidate);
    el.classList.add("zt-citations", "mod-complex", LIBRARY_ROW_CLASS);
    const contentEl = el.createDiv({ cls: "suggestion-content zt:min-w-0" });
    contentEl.createDiv({ cls: "suggestion-title", text: row.summary });
    contentEl.createDiv({ cls: "suggestion-note zt:font-mono", text: row.key });
    // The Library is a second fact, so it takes the trailing slot an item row
    // gives it, or a badge under the key on a narrow row.
    if (row.library) {
      appendLibraryBadge(
        contentEl.createDiv({ cls: "suggestion-note" }),
        row.library,
      );
      appendLibraryFlair(el, row.library);
    }
  }

  override onChooseSuggestion(candidate: AmbiguousCandidate): void {
    this.#choose(candidate);
  }
}

/**
 * Asks which Item an Ambiguous Citation Key should open, then opens that one
 * by its exact Indexed Key.
 */
export function registerCitekeyCandidatePicker(
  app: App,
  service: CitekeyEditor,
): () => void {
  return service.on("citekey-ambiguous", (ambiguous) => {
    new AmbiguousCitekeyModal(app, ambiguous, (candidate) => {
      void service.openCandidate(candidate, ambiguous.pane);
    }).open();
  });
}
