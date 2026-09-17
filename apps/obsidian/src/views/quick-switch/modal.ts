import { Keymap, Platform, SuggestModal } from "obsidian";
import type { PaneType, TFile } from "obsidian";

import { openAttachments, withFixedPane } from "@/lib/attachment-open";
import * as m from "@/lib/i18n/generated/messages";
import {
  createPdfReader,
  resolveLiteratureNoteAttachments,
} from "@/services/attachment-open/actions";
import { renderSuggestion as renderSearchHit } from "@/services/item-lookup/render-hit";
import { DEFAULT_LIMIT } from "@/services/item-lookup/service";
import type { SearchHit } from "@/services/item-lookup/service";
import { createNoteInteractively } from "@/services/note-feature";
import { resolveLiteratureNoteWithWarning } from "@/services/note-feature/update-single";

import type { QuickSwitchDeps } from "./register";

/** Glyph for the `Mod` modifier, matching how Obsidian labels its own hotkeys. */
function modGlyph(): string {
  return Platform.isMacOS ? "⌘" : "Ctrl";
}

/** Glyph for the `Shift` modifier, matching how Obsidian labels its own hotkeys. */
function shiftGlyph(): string {
  return Platform.isMacOS ? "⇧" : "Shift";
}

export class QuickSwitchModal extends SuggestModal<SearchHit> {
  readonly #deps: QuickSwitchDeps;

  constructor(deps: QuickSwitchDeps) {
    super(deps.app);
    this.#deps = deps;
    this.limit = DEFAULT_LIMIT;
    this.setInstructions([
      { command: "↑↓", purpose: m.instruction_navigate() },
      { command: "↵", purpose: m.instruction_open_lit_note() },
      { command: `${modGlyph()}↵`, purpose: m.instruction_new_pane() },
      { command: `${shiftGlyph()}↵`, purpose: m.instruction_open_pdf() },
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
    if (evt.shiftKey) {
      this.#openAttachment(hit, Keymap.isModEvent(evt));
      return;
    }
    await this.#deps.noteIndex.whenIndexed();
    const existing = resolveLiteratureNoteWithWarning(
      this.#deps.noteIndex.getNotesByItemKey(hit.item.indexedKey),
    );
    if (existing) {
      await this.#open(existing, evt);
      return;
    }
    await this.#open(await createNoteInteractively(this.#deps, hit.item), evt);
  }

  /**
   * Shift+Enter's PDF chord: the search index holds regular Items only, so the
   * Item's Attachments are resolved through the database, as the `open-pdf`
   * command does. No `event` reaches `openAttachments` — a keyboard-driven
   * chord carries no pointer to anchor a context menu at — so several
   * Attachments always fall to the Suggest modal picker; `pane` still honors
   * the chord's own Mod, wherever the open lands.
   */
  #openAttachment(hit: SearchHit, pane: PaneType | boolean): void {
    const attachments = resolveLiteratureNoteAttachments(
      this.#deps,
      hit.item.indexedKey,
    );
    openAttachments(attachments, {
      reader: withFixedPane(createPdfReader(this.#deps), pane),
      app: this.#deps.app,
    });
  }

  async #open(
    file: TFile | null | undefined,
    evt: MouseEvent | KeyboardEvent,
  ): Promise<void> {
    if (!file) return;

    await this.#deps.app.workspace.openLinkText(
      file.path,
      "",
      Keymap.isModEvent(evt),
      { active: true },
    );
  }
}
