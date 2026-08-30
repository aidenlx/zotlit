import { Keymap, Platform, SuggestModal } from "obsidian";
import type { TFile } from "obsidian";

import { confirm } from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { renderSuggestion as renderSearchHit } from "@/services/item-lookup/render-hit";
import { DEFAULT_LIMIT } from "@/services/item-lookup/service";
import type { SearchHit } from "@/services/item-lookup/service";
import { createNoteInteractively } from "@/services/note-feature";
import {
  noteOperationDiagnosticNotice,
  resolveLiteratureNoteWithWarning,
} from "@/services/note-feature/update-single";
import type { NoteProfile } from "@/services/profile/bindings";

import { chooseLiteratureNoteProfile } from "./profile-picker";
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

/** Interactive Imported Note re-stamp; it changes the next re-import only. */
export async function switchImportedNoteProfile(
  deps: QuickSwitchDeps,
  file: TFile,
): Promise<void> {
  await deps.profile.ready;
  const choice = await chooseLiteratureNoteProfile(
    deps.app,
    deps.profile.profiles,
  );
  if (!choice) return;
  const resolved = deps.profile.profileOf(file);
  if (resolved.ok && resolved.profile.selector === choice.id) return;
  const currentLabel = profileLabel(resolved);
  const shouldSwitch = await confirm(
    {
      title: m.modal_profile_switch_title({ label: choice.label }),
      content: m.modal_imported_note_profile_switch_desc({
        current: currentLabel,
        requested: choice.label,
      }),
      action: m.modal_profile_switch_confirm({ label: choice.label }),
      cancel: m.modal_profile_switch_keep({ label: currentLabel }),
      destructive: true,
    },
    deps.app,
  );
  if (!shouldSwitch) return;
  const result = await deps.noteFeature.switchImportedNoteProfile(file, {
    profile: choice.id,
  });
  if (result.diagnostic) {
    new BaseNotice(noteOperationDiagnosticNotice(result.diagnostic));
  }
}

/** Name the Profile a note resolves to, falling back to the stamp text. */
function profileLabel(resolved: NoteProfile): string {
  return resolved.ok
    ? (resolved.profile.label ?? m.settings_profile_default_name())
    : resolved.stamped.stamp;
}
