import { Keymap, SuggestModal } from "obsidian";

import { BaseNotice } from "@/lib/notice";
import type { SearchHit } from "@/services/item-lookup/engine";
import { renderSuggestion as renderSearchHit } from "@/services/item-lookup/render-hit";
import { DEFAULT_LIMIT } from "@/services/item-lookup/service";
import * as m from "@/paraglide/messages";
import type { QuickSwitchDeps } from "./register";

export class QuickSwitchModal extends SuggestModal<SearchHit> {
  readonly #deps: QuickSwitchDeps;

  constructor(deps: QuickSwitchDeps) {
    super(deps.app);
    this.#deps = deps;
    this.limit = DEFAULT_LIMIT;
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_open_lit_note() },
      { command: "⌘↵", purpose: m.instruction_new_pane() },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
  }

  override getSuggestions(query: string): SearchHit[] | Promise<SearchHit[]> {
    return this.#deps.lookup.search(query, { limit: this.limit });
  }

  override renderSuggestion(hit: SearchHit, el: HTMLElement): void {
    renderSearchHit(this.#deps.settings, hit, el);
  }

  override async onChooseSuggestion(
    hit: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): Promise<void> {
    const files = this.#deps.noteIndex
      .getNotesByItemKey(hit.item.indexedKey)
      .sort();
    const first = files[0];
    if (!first) {
      new BaseNotice(
        m.notice_no_literature_note({
          citekey: hit.item.citekey ?? hit.item.key,
        }),
      );
      return;
    }

    await this.#deps.app.workspace.openLinkText(
      first,
      "",
      Keymap.isModEvent(evt),
      { active: true },
    );
  }
}
