import { Keymap, MarkdownView, Platform } from "obsidian";
import type { PaneType, TFile } from "obsidian";

import { openAttachments, withFixedPane } from "@/lib/attachment-open";
import * as m from "@/lib/i18n/generated/messages";
import {
  createPdfReader,
  resolveLiteratureNoteAttachments,
} from "@/services/attachment-open/actions";
import { ItemSearchModal } from "@/services/item-lookup/search-modal";
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

  override async onChooseSuggestion(
    hit: SearchHit,
    evt: MouseEvent | KeyboardEvent,
  ): Promise<void> {
    if (evt.shiftKey) {
      await this.#openAttachment(hit, Keymap.isModEvent(evt));
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
  async #openAttachment(
    hit: SearchHit,
    pane: PaneType | boolean,
  ): Promise<void> {
    const attachments = await resolveLiteratureNoteAttachments(
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

    const { workspace } = this.#deps.app;
    const newPane = Keymap.isModEvent(evt);
    if (!newPane) {
      const existing = workspace
        .getLeavesOfType("markdown")
        .find(
          (leaf) =>
            leaf.view instanceof MarkdownView && leaf.view.file === file,
        );
      if (existing) {
        await workspace.revealLeaf(existing);
        workspace.setActiveLeaf(existing, { focus: true });
        return;
      }
    }
    await workspace.openLinkText(file.path, "", newPane, { active: true });
  }
}
