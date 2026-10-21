import { Keymap } from "obsidian";
import type { Editor, TFile } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { ItemSearchModal } from "@/services/item-lookup/search-modal";
import type { SearchHit } from "@/services/item-lookup/service";

import { readDocumentCitedKeys } from "./document-citations";
import {
  commitCitationInsert,
  resolveCitationInsert,
  writeCitation,
} from "./editor-suggest";
import type { CitationSuggestDeps } from "./register";

/**
 * Command-driven citation picker: search the library in a popup and insert the
 * rendered citation at the editor cursor. The inline `[@` flow lives in
 * {@link CitationEditorSuggest}; both render through `renderCitation`.
 */
export class InsertCitationModal extends ItemSearchModal {
  readonly #deps: CitationSuggestDeps;
  readonly #editor: Editor;
  readonly #file: TFile | null;
  #documentController?: AbortController;
  #cited: Promise<readonly string[]> = Promise.resolve([]);

  constructor(deps: CitationSuggestDeps, editor: Editor, file: TFile | null) {
    super(deps);
    this.#deps = deps;
    this.#editor = editor;
    this.#file = file;
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

  override onOpen(): void {
    this.#documentController = new AbortController();
    this.#cited = readDocumentCitedKeys(
      this.#deps.citationIndex,
      this.#file,
      this.#documentController.signal,
    );
    super.onOpen();
  }

  override onClose(): void {
    this.#documentController?.abort();
    super.onClose();
  }

  override async getSuggestions(query: string): Promise<SearchHit[]> {
    const controller = this.#documentController;
    const cited = await this.#cited;
    if (!controller || controller.signal.aborted) return [];
    return super.getSuggestions(query, { cited });
  }

  override async onChooseSuggestion(
    hit: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): Promise<void> {
    const before = this.#editor.getValue();
    const from = this.#editor.getCursor("from");
    const to = this.#editor.getCursor("to");
    const outcome = await resolveCitationInsert(
      this.#deps,
      hit,
      Keymap.isModifier(evt, "Shift") ? "alt" : "main",
    );
    if (this.#editor.getValue() !== before) return;
    if (outcome.kind === "notice") {
      new BaseNotice(outcome.message);
      return;
    }
    commitCitationInsert(this.#deps, {
      indexedKey: hit.item.indexedKey,
      text: outcome.text,
      insert: () => writeCitation(this.#editor, outcome.text, { from, to }),
    });
  }
}
