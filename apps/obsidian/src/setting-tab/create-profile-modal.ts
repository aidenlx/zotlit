// Collect the initial bindings and template for a new Profile document.
import { Modal, Setting } from "obsidian";
import type { TextComponent } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import type { ProfileBindings } from "@/services/profile/service";

import type { SettingTabContext } from "./context";

export class CreateProfileModal extends Modal {
  readonly #ctx: SettingTabContext;

  constructor(ctx: SettingTabContext) {
    super(ctx.app);
    this.#ctx = ctx;
  }

  override onOpen(): void {
    this.contentEl.addClass("zt-root");
    this.setTitle(m.settings_profile_add());
    let label = "";
    let templatePath = "";
    const bindings: ProfileBindings = {};
    let citationText: TextComponent;
    new Setting(this.contentEl)
      .setName(m.settings_profile_name_name())
      .addText((text) =>
        text.onChange((value) => {
          label = value;
        }),
      );
    new Setting(this.contentEl)
      .setName(m.settings_profile_folder_name())
      .addText((text) =>
        text.setPlaceholder(m.settings_profile_inherit()).onChange((value) => {
          if (value) bindings.folder = value;
          else delete bindings.folder;
        }),
      );
    new Setting(this.contentEl)
      .setName(m.settings_note_import_folder_name())
      .addText((text) =>
        text.setPlaceholder(m.settings_profile_inherit()).onChange((value) => {
          if (value) bindings.importFolder = value;
          else delete bindings.importFolder;
        }),
      );
    new Setting(this.contentEl)
      .setName(m.settings_profile_citation_style_name())
      .addText((text) => {
        citationText = text;
        text.setPlaceholder(m.settings_profile_inherit()).onChange((value) => {
          if (value) bindings.citationStyle = value;
          else delete bindings.citationStyle;
        });
      });
    new Setting(this.contentEl)
      .setName(m.settings_profile_citation_style_none())
      .addToggle((toggle) =>
        toggle.onChange((value) => {
          citationText.setDisabled(value);
          if (value) bindings.citationStyle = null;
          else if (citationText.getValue())
            bindings.citationStyle = citationText.getValue();
          else delete bindings.citationStyle;
        }),
      );
    for (const [key, name] of [
      [
        "importColoredHighlights",
        m.settings_note_import_colored_highlights_name(),
      ],
      [
        "importAnnotationsAsTemplate",
        m.settings_note_import_annotations_template_name(),
      ],
    ] as const) {
      new Setting(this.contentEl).setName(name).addDropdown((dropdown) =>
        dropdown
          .addOptions({
            inherit: m.settings_profile_inherit(),
            enabled: m.settings_profile_enabled(),
            disabled: m.settings_profile_disabled(),
          })
          .onChange((value) => {
            if (value === "inherit") delete bindings[key];
            else bindings[key] = value === "enabled";
          }),
      );
    }
    new Setting(this.contentEl)
      .setName(m.settings_profile_document_name())
      .addDropdown((dropdown) => {
        dropdown.addOption("", m.settings_profile_document_builtin());
        for (const status of this.#ctx.template.getLiteratureNoteTemplateStatuses()) {
          if (status.validation.state === "valid")
            dropdown.addOption(status.path, status.reference);
        }
        dropdown.onChange((value) => {
          templatePath = value;
        });
      });
    const error = this.contentEl.createDiv();
    new Setting(this.contentEl).addButton((button) =>
      button
        .setButtonText(m.settings_profile_add())
        .setCta()
        .onClick(async () => {
          button.setDisabled(true);
          try {
            const file = templatePath
              ? this.app.vault.getFileByPath(templatePath)
              : null;
            const source = file
              ? await this.app.vault.cachedRead(file)
              : undefined;
            const profile = await this.#ctx.profile.create({
              label,
              source,
              bindings,
            });
            this.#ctx.requestUpdate();
            this.close();
            const created = this.app.vault.getFileByPath(profile.path);
            if (created)
              await this.app.workspace.getLeaf(true).openFile(created);
          } catch (failure) {
            error.setText(
              Error.isError(failure)
                ? failure.message
                : m.notice_profile_action_failed(),
            );
            button.setDisabled(false);
          }
        }),
    );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
