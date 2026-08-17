// The dialog one note's Citation Presentation is set from: the style it renders
// under and its Document Language, together in one confirmation.

import { Modal, Setting } from "obsidian";
import type { App, TextComponent } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { citationLocaleError } from "@/setting-tab/citations";
import { addStyleDropdown } from "@/views/style-dropdown";

import { STYLE_INHERITED, stylePickerOptions } from "./presentation";
import type {
  CitationPresentationChoice,
  DeclaredPresentation,
} from "./presentation";

export interface CitationPresentationModalOptions {
  /** Zotero data directory the installed styles are listed from. */
  dataDir: string;
  /** The vault Citation and References Style; `null` selects Default. */
  vaultStyleId: string | null;
  /** The vault Citation Locale; empty leaves the style's own locale in charge. */
  vaultLocale: string;
  /** What the note's own properties hold right now. */
  declared: DeclaredPresentation;
}

/**
 * The dialog opens on what the note reads as today — the style it names or the
 * vault style it inherits, and the Document Language it declares — so a note
 * that carries neither property is configured the same way as one that does.
 *
 * @returns the choice, or `null` when the user dismissed the dialog.
 */
export function openCitationPresentationModal(
  app: App,
  {
    dataDir,
    vaultStyleId,
    vaultLocale,
    declared,
  }: CitationPresentationModalOptions,
): Promise<CitationPresentationChoice | null> {
  const { promise, resolve } =
    Promise.withResolvers<CitationPresentationChoice | null>();

  let styleId = declared.styleId;
  let languageInput: TextComponent;

  const modal = new Modal(app);
  modal.setTitle(m.citation_presentation_title());
  modal.contentEl.addClass("zt-root");

  addStyleDropdown(
    new Setting(modal.contentEl)
      .setName(m.citation_presentation_style_name())
      .setDesc(m.citation_presentation_style_desc()),
    {
      dataDir,
      value: styleId ?? STYLE_INHERITED,
      options: (styles, selected) =>
        stylePickerOptions(styles, {
          selected: asStyleId(selected),
          vaultStyleId,
        }),
      onChange: (value) => {
        styleId = asStyleId(value);
      },
    },
  );

  new Setting(modal.contentEl)
    .setName(m.citation_presentation_language_name())
    .setDesc(m.citation_presentation_language_desc())
    .addText((text) => {
      languageInput = text;
      text.setPlaceholder(vaultLocale || m.settings_citation_locale_default());
      text.setValue(declared.language);
      text.onChange(() => text.inputEl.setCustomValidity(""));
    })
    // Emptying the field removes the property, which is what hands the note
    // back to the vault Citation Locale, so the reset says both.
    .addButton((button) =>
      button
        .setButtonText(m.citation_presentation_language_reset())
        .onClick(() => {
          languageInput.setValue("");
          languageInput.inputEl.setCustomValidity("");
        }),
    );

  new Setting(modal.contentEl)
    .addButton((button) =>
      button.setButtonText(m.modal_cancel()).onClick(() => modal.close()),
    )
    .addButton((button) =>
      button
        .setButtonText(m.citation_presentation_confirm())
        .setCta()
        .onClick(() => submit()),
    );

  modal.setCloseCallback(() => resolve(null));
  modal.open();
  return promise;

  /** A Document Language citeproc cannot read stops at the field it was typed in. */
  function submit(): void {
    const language = languageInput.getValue().trim();
    const invalid = citationLocaleError(language);
    if (invalid) {
      languageInput.inputEl.setCustomValidity(invalid);
      languageInput.inputEl.reportValidity();
      return;
    }
    resolve({ styleId, language: language || null });
    modal.close();
  }
}

function asStyleId(value: string): string | null {
  return value === STYLE_INHERITED ? null : value;
}
