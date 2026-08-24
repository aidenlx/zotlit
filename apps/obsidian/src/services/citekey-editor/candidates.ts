// UI seam for an Ambiguous Citation Key: the picker that opens one candidate exactly.

import { SuggestModal } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { candidateRow } from "@/services/citation-index/ambiguity";
import type {
  AmbiguousCandidate,
  CandidateRow,
} from "@/services/citation-index/ambiguity";

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
    const contentEl = el.createDiv("suggestion-content");
    contentEl.createDiv({ cls: "suggestion-title", text: row.summary });
    // The Library name and the key are two facts, so the row keeps them apart.
    const noteEl = contentEl.createDiv(
      "suggestion-note zt:flex zt:gap-2 zt:min-w-0",
    );
    if (row.library) noteEl.createSpan({ text: row.library });
    noteEl.createSpan({ text: row.key });
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
