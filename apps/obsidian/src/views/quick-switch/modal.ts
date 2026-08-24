import { Keymap, Platform, SuggestModal } from "obsidian";
import type { TFile } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import * as toast from "@/lib/toast";
import { renderSuggestion as renderSearchHit } from "@/services/item-lookup/render-hit";
import { DEFAULT_LIMIT } from "@/services/item-lookup/service";
import type { SearchHit } from "@/services/item-lookup/service";
import { EmptyFilenameError } from "@/services/note-feature/filename";
import { InertTemplateError } from "@/services/template/errors";

import type { QuickSwitchDeps } from "./register";

/** Glyph for the `Mod` modifier, matching how Obsidian labels its own hotkeys. */
function modGlyph(): string {
  return Platform.isMacOS ? "⌘" : "Ctrl";
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
      { command: "esc", purpose: m.instruction_dismiss() },
    ]);
    // The suggestion popup registers `Enter` with no modifiers and matches
    // them exactly, so Mod+Enter reaches no handler unless the modal claims
    // the chord itself.
    this.scope.register(["Mod"], "Enter", (evt) => {
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
    const existing = this.#deps.noteIndex.getNotesByItemKey(
      hit.item.indexedKey,
    )[0];
    const file = existing ?? (await this.#create(hit));
    if (!file) return;

    await this.#deps.app.workspace.openLinkText(
      file.path,
      "",
      Keymap.isModEvent(evt),
      { active: true },
    );
  }

  /** Create-arm: no existing note → render one and return it. */
  async #create(hit: SearchHit): Promise<TFile | null> {
    try {
      const file = await toast.promise(
        this.#deps.noteFeature.createNote(hit.item),
        {
          loading: m.notice_creating_note(),
          success: m.notice_created_note(),
          error: (_msg, e) =>
            e instanceof EmptyFilenameError || e instanceof InertTemplateError
              ? e.message
              : m.notice_create_note_failed(),
          swallowError: false,
        },
      );
      return file;
    } catch {
      // toast.promise already surfaced the failure to the user.
      return null;
    }
  }
}
