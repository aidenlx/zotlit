import { SuggestModal } from "obsidian";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { LiteratureNoteProfile } from "@/services/settings/schema";

export interface LiteratureNoteProfileChoice {
  id: string | null;
  label: string;
}

export function chooseLiteratureNoteProfile(
  app: App,
  profiles: readonly LiteratureNoteProfile[],
): Promise<LiteratureNoteProfileChoice | undefined> {
  return new Promise((resolve) => {
    new LiteratureNoteProfileModal(app, profiles, resolve).open();
  });
}

class LiteratureNoteProfileModal extends SuggestModal<LiteratureNoteProfileChoice> {
  readonly #choices: LiteratureNoteProfileChoice[];
  readonly #resolve: (choice: LiteratureNoteProfileChoice | undefined) => void;
  #settled = false;

  constructor(
    app: App,
    profiles: readonly LiteratureNoteProfile[],
    resolve: (choice: LiteratureNoteProfileChoice | undefined) => void,
  ) {
    super(app);
    this.#choices = [
      { id: null, label: m.settings_profile_default_name() },
      ...profiles.map(({ id, label }) => ({ id, label })),
    ];
    this.#resolve = resolve;
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
    el.setText(choice.label);
  }

  override onChooseSuggestion(choice: LiteratureNoteProfileChoice): void {
    this.#settled = true;
    this.#resolve(choice);
  }

  override onClose(): void {
    if (!this.#settled) this.#resolve(undefined);
  }
}
