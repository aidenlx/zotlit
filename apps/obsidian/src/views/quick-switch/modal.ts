import { Keymap, Platform } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { ItemSearchModal } from "@/services/item-lookup/search-modal";
import type { SearchHit } from "@/services/item-lookup/service";

import type { QuickSwitchDeps } from "./register";
import { openItemPdf, openOrCreateNote } from "./result-actions";

/** Glyph for the `Mod` modifier, matching how Obsidian labels its own hotkeys. */
function modGlyph(): string {
  return Platform.isMacOS ? "⌘" : "Ctrl";
}

/** Glyph for the `Shift` modifier, matching how Obsidian labels its own hotkeys. */
function shiftGlyph(): string {
  return Platform.isMacOS ? "⇧" : "Shift";
}

/** Glyph for the `Alt` modifier, matching how Obsidian labels its own hotkeys. */
function altGlyph(): string {
  return Platform.isMacOS ? "⌥" : "Alt";
}

export class QuickSwitchModal extends ItemSearchModal {
  readonly #deps: QuickSwitchDeps;

  constructor(deps: QuickSwitchDeps) {
    super(deps);
    this.#deps = deps;
    this.setPlaceholder(m.modal_literature_search_placeholder());
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_open_lit_note() },
      { command: `${modGlyph()}↵`, purpose: m.instruction_new_pane() },
      { command: `${shiftGlyph()}↵`, purpose: m.instruction_open_pdf() },
      {
        command: `${altGlyph()}↵`,
        purpose: m.instruction_show_in_library(),
      },
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
    // The suggestion popup registers `Enter` with no modifiers and matches
    // them exactly, so Mod+Enter, Shift+Enter, and Mod+Shift+Enter each reach
    // no handler unless the modal claims the chord itself.
    this.scope.register(["Mod"], "Enter", (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
    this.scope.register(["Shift"], "Enter", (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
    this.scope.register(["Mod", "Shift"], "Enter", (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
    this.scope.register(["Alt"], "Enter", (evt) => {
      this.selectActiveSuggestion(evt);
      return false;
    });
  }

  override async onChooseSuggestion(
    hit: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): Promise<void> {
    const { indexedKey } = hit.item;
    if (evt.altKey) {
      await this.#deps.showInLibrary(indexedKey);
      return;
    }
    if (evt.shiftKey) {
      await openItemPdf(this.#deps, indexedKey, Keymap.isModEvent(evt));
      return;
    }
    await openOrCreateNote(this.#deps, {
      indexedKey,
      item: hit.item,
      newPane: Keymap.isModEvent(evt),
    });
  }
}
