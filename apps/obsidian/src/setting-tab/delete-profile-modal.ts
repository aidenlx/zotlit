// Profile deletion gathers target and file-move consent in the same dialog,
// and names the Profile Selection Rules the user must repair afterwards.
import { dirname } from "node:path/posix";
import { ConfirmationModal } from "obsidian";
import type { App } from "obsidian";

import { normalizeFolderPath } from "@/lib/ensure-folder";
import * as m from "@/lib/i18n/generated/messages";
import { DEFAULT_PROFILE } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import type { InstalledCslStyle } from "@/services/pandoc/styles";
import type { ProfileDeletionPlan } from "@/services/profile/service";
import {
  profilePreviewChoice,
  renderProfileChoice,
} from "@/views/quick-switch/profile-picker";

export interface ProfileDeletionConsent {
  target: ProfileSelector;
  move: boolean;
}

export function confirmProfileDeletion(
  app: App,
  options: { plan: ProfileDeletionPlan; styles?: readonly InstalledCslStyle[] },
): Promise<ProfileDeletionConsent | undefined> {
  const { plan } = options;
  const { promise, resolve } = Promise.withResolvers<
    ProfileDeletionConsent | undefined
  >();
  const modal = new ConfirmationModal(app);
  modal.contentEl.addClass("zt-root");
  modal.setTitle(
    m.settings_profile_delete_confirm_title({ label: plan.source.label }),
  );
  const count = plan.literatureNotes.length + plan.importedNotes.length;
  let target =
    plan.targets.find(({ profile }) => profile.selector === DEFAULT_PROFILE) ??
    plan.targets[0];
  let move = false;
  modal.setContent(
    count
      ? [
          m.settings_profile_delete_literature_count({
            count: plan.literatureNotes.length,
          }),
          m.settings_profile_delete_imported_count({
            count: plan.importedNotes.length,
          }),
          m.settings_profile_delete_move_desc(),
        ].join("\n\n")
      : `${m.settings_profile_delete_unused()}\n\n${m.settings_profile_delete_confirm_body()}`,
  );
  if (count) {
    const group = modal.contentEl.createEl("fieldset", {
      cls: "zt:my-4 zt:space-y-2",
    });
    group.createEl("legend", {
      text: m.settings_profile_delete_target(),
      cls: "zt:mb-2 zt:font-semibold",
    });
    const rows = plan.targets.map((entry) => {
      const label = group.createEl("label", {
        cls: "zt:flex zt:items-start zt:gap-2 zt:rounded-sm zt:border zt:border-border zt:p-2",
      });
      const radio = label.createEl("input", {
        type: "radio",
        attr: { name: "zotlit-delete-profile-target" },
      });
      radio.checked = entry === target;
      const content = label.createDiv({ cls: "zt:min-w-0" });
      const profile = entry.profile;
      const choice = profilePreviewChoice(
        {
          selector: profile.selector,
          label: profile.label,
          folder: profile.bindings["note.literature-folder"],
          citationStyle: profile.bindings["citation.references-style"],
          document: profile.document,
          path: entry.files.map(({ path }) => path).join("\n"),
        },
        { styles: options.styles },
      );
      return { entry, radio, content, choice };
    });
    modal.contentEl.createEl("p", { text: m.modal_profile_switch_effects() });
    const moveLabel = modal.contentEl.createEl("label", {
      cls: "zt:my-4 zt:flex zt:items-center zt:gap-2",
    });
    const checkbox = moveLabel.createEl("input", { type: "checkbox" });
    const caption = moveLabel.createSpan();
    checkbox.addEventListener("change", () => {
      move = checkbox.checked;
    });
    const update = () => {
      for (const row of rows) {
        row.radio.checked = row.entry === target;
        row.content.empty();
        renderProfileChoice(
          { ...row.choice, preselected: row.radio.checked },
          row.content,
        );
      }
      const folders = [
        ...new Set(
          target?.files
            .filter(({ file, path }) => path !== file.path)
            .map(({ path }) => normalizeFolderPath(dirname(path))) ?? [],
        ),
      ];
      moveLabel.hidden = folders.length === 0;
      caption.setText(
        m.settings_profile_delete_move_files({
          folder: folders
            .map((folder) => (folder === "/" ? folder : `${folder}/`))
            .join(", "),
        }),
      );
      checkbox.checked = false;
      move = false;
    };
    for (const row of rows)
      row.radio.addEventListener("change", () => {
        target = row.entry;
        update();
      });
    update();
  }
  modal.addButton((button) =>
    button
      .setButtonText(
        count
          ? m.settings_profile_delete_move_confirm({ count })
          : m.settings_profile_delete(),
      )
      .setDisabled(count > 0 && !target)
      .setDestructive()
      .onClick(() =>
        resolve({ target: target?.profile.selector ?? DEFAULT_PROFILE, move }),
      ),
  );
  modal.addCancelButton(m.modal_cancel());
  modal.setCloseCallback(() => resolve(undefined));
  modal.open();
  return promise;
}
