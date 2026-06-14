import { SuggestModal, type Editor } from "obsidian";

import { BaseNotice } from "@/lib/notice";
import * as m from "@/paraglide/messages";
import { renderSuggestion as renderSearchHit } from "@/services/item-lookup/render-hit";
import { DEFAULT_LIMIT, type SearchHit } from "@/services/item-lookup/service";

import { type CitationSuggestDeps } from "./register";

/**
 * Command-driven citation picker: search the library in a popup and insert the
 * rendered citation at the editor cursor. The inline `[@` flow lives in
 * {@link CitationEditorSuggest}; both render through `NoteFeatures.renderCitation`.
 */
export class InsertCitationModal extends SuggestModal<SearchHit> {
  readonly #deps: CitationSuggestDeps;
  readonly #editor: Editor;

  constructor(deps: CitationSuggestDeps, editor: Editor) {
    super(deps.app);
    this.#deps = deps;
    this.#editor = editor;
    this.limit = DEFAULT_LIMIT;
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_insert_citation() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }

  override getSuggestions(query: string): SearchHit[] | Promise<SearchHit[]> {
    return this.#deps.lookup.search(query, { limit: this.limit });
  }

  override renderSuggestion(hit: SearchHit, el: HTMLElement): void {
    renderSearchHit(this.#deps.settings, hit, el);
  }

  override onChooseSuggestion(hit: SearchHit): void {
    const citationKey = "citationKey" in hit.item ? hit.item.citationKey : null;
    if (!citationKey) {
      new BaseNotice(m.notice_no_citekey({ key: hit.item.key }));
      return;
    }
    const rendered = this.#deps.noteFeatures.renderCitation([{ citationKey }]);
    this.#editor.replaceSelection(rendered);
  }
}
