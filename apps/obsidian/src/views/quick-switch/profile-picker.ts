import { SuggestModal } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { DEFAULT_PROFILE } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import type { LiteratureNoteProfile } from "@/services/profile/service";

export interface LiteratureNoteProfileChoice {
  id: ProfileSelector;
  label: string;
  detail?: string;
}

export function chooseLiteratureNoteProfile(
  app: App,
  profiles: readonly LiteratureNoteProfile[],
  { preselected = DEFAULT_PROFILE }: { preselected?: ProfileSelector } = {},
): Promise<LiteratureNoteProfileChoice | undefined> {
  return new Promise((resolve) => {
    new LiteratureNoteProfileModal(app, profiles, {
      resolve,
      preselected,
    }).open();
  });
}

class LiteratureNoteProfileModal extends SuggestModal<LiteratureNoteProfileChoice> {
  readonly #choices: LiteratureNoteProfileChoice[];
  readonly #resolve: (choice: LiteratureNoteProfileChoice | undefined) => void;
  #settled = false;

  constructor(
    app: App,
    profiles: readonly LiteratureNoteProfile[],
    options: {
      resolve: (choice: LiteratureNoteProfileChoice | undefined) => void;
      preselected: ProfileSelector;
    },
  ) {
    super(app);
    this.#choices = [
      { id: DEFAULT_PROFILE, label: m.settings_profile_default_name() },
      ...profiles.map(({ id, label, document, bindings }) => ({
        id,
        label:
          profiles.filter((profile) => profile.label === label).length > 1
            ? `${label} (${document})`
            : label,
        detail: m.settings_profile_display({
          folder:
            bindings["note.literature-folder"] ?? m.settings_profile_inherit(),
          style:
            bindings["citation.references-style"] === null
              ? m.settings_profile_citation_style_none()
              : (bindings["citation.references-style"] ??
                m.settings_profile_inherit()),
          document,
        }),
      })),
    ];
    const selectedIndex = this.#choices.findIndex(
      ({ id }) => id === options.preselected,
    );
    if (selectedIndex > 0)
      this.#choices.unshift(...this.#choices.splice(selectedIndex, 1));
    this.#resolve = options.resolve;
    this.setPlaceholder(m.modal_profile_choose_placeholder());
  }

  override getSuggestions(query: string): LiteratureNoteProfileChoice[] {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? this.#choices.filter(({ label }) =>
          label.toLocaleLowerCase().includes(normalized),
        )
      : this.#choices;
  }

  override renderSuggestion(
    choice: LiteratureNoteProfileChoice,
    el: HTMLElement,
  ): void {
    el.createDiv({ text: choice.label });
    if (choice.detail)
      el.createDiv({ text: choice.detail, cls: "suggestion-note" });
  }

  override onChooseSuggestion(choice: LiteratureNoteProfileChoice): void {
    this.#settled = true;
    this.#resolve(choice);
  }

  override onClose(): void {
    if (!this.#settled) this.#resolve(undefined);
  }
}
