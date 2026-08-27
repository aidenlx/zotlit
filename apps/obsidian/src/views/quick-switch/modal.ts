import { Keymap, Platform, SuggestModal } from "obsidian";
import type { TFile } from "obsidian";

import { confirm } from "@/lib/confirm";
import { FIELD_LITERATURE_NOTE_PROFILE } from "@/lib/constants";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { renderSuggestion as renderSearchHit } from "@/services/item-lookup/render-hit";
import { DEFAULT_LIMIT } from "@/services/item-lookup/service";
import type { SearchHit } from "@/services/item-lookup/service";
import {
  createNoteWithToast,
  noteProfileDiagnosticNotice,
  resolveLiteratureNoteWithWarning,
} from "@/services/note-feature/update-single";

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
    const existing = resolveLiteratureNoteWithWarning(
      this.#deps.noteIndex.getNotesByItemKey(hit.item.indexedKey),
    );
    const profiles = this.#deps.settings.current?.["note.profiles"] ?? [];
    if (profiles.length === 0) {
      await this.#open(existing ?? (await this.#create(hit)), evt);
      return;
    }

    const choice = await chooseLiteratureNoteProfile(this.#deps.app, profiles);
    if (!choice) return;
    const file = existing
      ? await this.#resolveExisting(hit, existing, choice)
      : await this.#create(hit, choice.id);
    await this.#open(file, evt);
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

  /** Create-arm: no existing note → render one and return it. */
  async #create(
    hit: SearchHit,
    profileId?: string | null,
  ): Promise<TFile | null> {
    return createNoteWithToast(this.#deps.noteFeature, hit.item, profileId);
  }

  async #resolveExisting(
    hit: SearchHit,
    file: TFile,
    choice: { id: string | null; label: string },
  ): Promise<TFile> {
    const stamped =
      this.#deps.app.metadataCache.getFileCache(file)?.frontmatter?.[
        FIELD_LITERATURE_NOTE_PROFILE
      ];
    const stampedId = stamped === undefined ? null : String(stamped);
    if (stampedId === choice.id) return file;
    const currentLabel =
      stampedId === null
        ? m.settings_profile_default_name()
        : (this.#deps.settings.current?.["note.profiles"].find(
            (profile) => profile.id === stampedId,
          )?.label ?? stampedId);

    const shouldSwitch = await confirm(
      {
        title: m.modal_profile_switch_title({ label: choice.label }),
        content: m.modal_profile_switch_desc({
          current: currentLabel,
          requested: choice.label,
        }),
        action: m.modal_profile_switch_confirm({ label: choice.label }),
        cancel: m.modal_profile_switch_keep({ label: currentLabel }),
        destructive: true,
      },
      this.#deps.app,
    );
    if (!shouldSwitch) return file;

    const result = await this.#deps.noteFeature.switchNoteProfile(file, {
      indexedKey: hit.item.indexedKey,
      profileId: choice.id,
    });
    if (result.diagnostic) {
      new BaseNotice(noteProfileDiagnosticNotice(result.diagnostic));
    }
    return file;
  }
}
