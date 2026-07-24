import { Keymap, SuggestModal, type Editor } from "obsidian";

import { BaseNotice } from "@/lib/notice";
import * as m from "@/paraglide/messages";
import { renderSuggestion as renderSearchHit } from "@/services/item-lookup/render-hit";
import { DEFAULT_LIMIT, type SearchHit } from "@/services/item-lookup/service";
import { InertTemplateError } from "@/services/template/errors";

import { padCitationInsert } from "./editor-suggest";
import { type CitationSuggestDeps } from "./register";

/**
 * Command-driven citation picker: search the library in a popup and insert the
 * rendered citation at the editor cursor. The inline `[@` flow lives in
 * {@link CitationEditorSuggest}; both render through `renderCitation`.
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
      { command: "⇧↵", purpose: m.instruction_insert_secondary_citation() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }

  override getSuggestions(query: string): SearchHit[] | Promise<SearchHit[]> {
    return this.#deps.lookup.search(query, { limit: this.limit });
  }

  override renderSuggestion(hit: SearchHit, el: HTMLElement): void {
    renderSearchHit(this.#deps.settings, hit, el);
  }

  override onChooseSuggestion(
    hit: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    const citationKey =
      "citationKey" in hit.item.fields ? hit.item.fields.citationKey : null;
    if (!citationKey) {
      new BaseNotice(m.notice_no_citekey({ key: hit.item.key }));
      return;
    }
    let rendered: string | null;
    try {
      rendered = this.#deps.noteFeature.renderCitation(
        [{ citationKey, item: hit.item }],
        Keymap.isModifier(evt, "Shift"),
      );
    } catch (e) {
      if (!(e instanceof InertTemplateError)) throw e;
      new BaseNotice(e.message);
      return;
    }
    if (rendered === null) {
      new BaseNotice(m.notice_template_not_ready());
      return;
    }
    const editor = this.#editor;
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const padded = padCitationInsert(
      rendered,
      editor.getLine(to.line).charAt(to.ch),
    );
    editor.replaceRange(padded.text, from, to);
    editor.setCursor(
      editor.offsetToPos(editor.posToOffset(from) + padded.cursor),
    );
  }
}
