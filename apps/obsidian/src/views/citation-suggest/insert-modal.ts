import { Keymap } from "obsidian";
import type { Editor } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { ItemSearchModal } from "@/services/item-lookup/search-modal";
import type { SearchHit } from "@/services/item-lookup/service";

import { padCitationInsert, resolveCitationInsert } from "./editor-suggest";
import type { CitationSuggestDeps } from "./register";

/**
 * Command-driven citation picker: search the library in a popup and insert the
 * rendered citation at the editor cursor. The inline `[@` flow lives in
 * {@link CitationEditorSuggest}; both render through `renderCitation`.
 */
export class InsertCitationModal extends ItemSearchModal {
  readonly #deps: CitationSuggestDeps;
  readonly #editor: Editor;

  constructor(deps: CitationSuggestDeps, editor: Editor) {
    super(deps);
    this.#deps = deps;
    this.#editor = editor;
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_insert_citation() },
      { command: "⇧↵", purpose: m.instruction_insert_alternate_citation() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
    // The suggestion popup registers `Enter` with no modifiers and matches
    // them exactly, so Shift+Enter reaches no handler unless the modal claims
    // the chord itself.
    this.scope.register(["Shift"], "Enter", (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
  }

  override onChooseSuggestion(
    hit: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): void {
    const outcome = resolveCitationInsert(
      this.#deps,
      hit,
      Keymap.isModifier(evt, "Shift") ? "alt" : "main",
    );
    if (outcome.kind === "notice") {
      new BaseNotice(outcome.message);
      return;
    }
    const editor = this.#editor;
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const padded = padCitationInsert(
      outcome.text,
      editor.getLine(to.line).charAt(to.ch),
    );
    editor.replaceRange(padded.text, from, to);
    editor.setCursor(
      editor.offsetToPos(editor.posToOffset(from) + padded.cursor),
    );
  }
}
