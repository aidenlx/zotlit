// Settings for the default Profile and file actions for Profile documents.
import { basename } from "node:path/posix";
import type { SettingDefinitionItem } from "obsidian";

import { confirm } from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type { ProfileId } from "@/lib/profile-stamp";
import type { SettingsService } from "@/services/settings/service";
import { chooseLiteratureNoteProfile } from "@/views/quick-switch/profile-picker";

import { referencesStyleDefinition } from "./citations";
import type {
  ProfileControlKey,
  SettingsControlKey,
  SettingTabContext,
} from "./context";
import { CreateProfileModal } from "./create-profile-modal";
import { defaultProfileBindingPlaceholder } from "./placeholder";

const logger = getLogger(["setting-tab", "profiles"]);
type ProfileControlField =
  | "folder"
  | "citation-style"
  | "import-folder"
  | "colored-highlights"
  | "annotations-as-template";
const bindingKeys = {
  folder: "note.literature-folder",
  "citation-style": "citation.references-style",
  "import-folder": "note.import-folder",
  "colored-highlights": "note.import-colored-highlights",
  "annotations-as-template": "note.import-annotations-as-template",
} as const;

export function literatureNoteProfileItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey>[] {
  const profiles = ctx.profile.profiles;
  return [
    {
      type: "page",
      name: m.settings_page_profiles(),
      desc: m.settings_page_profiles_desc(),
      items: [
        ...defaultProfileItems(ctx),
        {
          name: m.settings_profile_heading(),
          render: (setting) => {
            setting.addButton((button) =>
              button
                .setButtonText(m.settings_profile_add())
                .setDisabled(
                  !ctx.profile.loaded ||
                    !!ctx.settings.current?.[
                      "note.template-conversion-pending"
                    ],
                )
                .onClick(() => new CreateProfileModal(ctx).open()),
            );
          },
        },
        ...profiles.map(
          (profile): SettingDefinitionItem<SettingsControlKey> => ({
            name: profile.label,
            desc: profile.document,
            render: (setting) => {
              setting.addButton((button) =>
                button
                  .setButtonText(m.settings_profile_document_open())
                  .onClick(() => void openDocument(ctx, profile.path)),
              );
              setting.addButton((button) =>
                button.setButtonText(m.settings_profile_duplicate()).onClick(
                  () =>
                    void runAction(async () => {
                      await ctx.profile.duplicate(profile.id);
                    }, ctx),
                ),
              );
              setting.addButton((button) =>
                button
                  .setButtonText(m.settings_profile_delete())
                  .setDestructive()
                  .onClick(() => void deleteProfile(ctx, profile.id)),
              );
            },
          }),
        ),
        ...ctx.profile.diagnostics.map(
          (diagnostic): SettingDefinitionItem<SettingsControlKey> => ({
            name: diagnostic.path,
            desc:
              diagnostic.code === "duplicate-profile-id"
                ? m.settings_profile_duplicate_id({
                    paths: diagnostic.paths!.join(", "),
                  })
                : m.settings_profile_document_invalid({
                    path: diagnostic.path,
                    error:
                      diagnostic.reason === "invalid-profile-id"
                        ? m.settings_profile_id_invalid()
                        : diagnostic.message,
                  }),
            render: (setting) => {
              setting.addButton((button) =>
                button
                  .setButtonText(m.settings_profile_document_open())
                  .onClick(() => void openDocument(ctx, diagnostic.path)),
              );
            },
          }),
        ),
      ],
    },
  ];
}

async function openDocument(
  ctx: SettingTabContext,
  path: string,
): Promise<void> {
  const file = ctx.app.vault.getFileByPath(path);
  if (file) await ctx.app.workspace.getLeaf(true).openFile(file);
}

async function runAction(
  action: () => Promise<void>,
  ctx: SettingTabContext,
): Promise<void> {
  try {
    await action();
    ctx.requestUpdate();
  } catch (error) {
    logger.error("Profile action failed", { error });
    new BaseNotice(m.notice_profile_action_failed());
  }
}

async function deleteProfile(
  ctx: SettingTabContext,
  id: ProfileId,
): Promise<void> {
  const source = ctx.profile.profiles.find((profile) => profile.id === id);
  if (!source) return;
  const target = await chooseLiteratureNoteProfile(
    ctx.app,
    ctx.profile.profiles.filter((profile) => profile.id !== id),
  );
  if (!target) return;
  if (
    !(await confirm(
      {
        title: m.settings_profile_delete_confirm_title({ label: source.label }),
        content: m.settings_profile_delete_move_desc({ label: target.label }),
        action: m.settings_profile_delete(),
        destructive: true,
      },
      ctx.app,
    ))
  )
    return;
  await runAction(() => ctx.profile.delete(id, target.id), ctx);
}

function defaultDocumentItem(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey> {
  const path = ctx.profile.defaultDocumentPath;
  const ejected = ctx.app.vault.getFileByPath(path) !== null;
  return {
    name: m.settings_profile_document_name(),
    desc: ejected ? basename(path) : m.settings_profile_document_builtin(),
    render: (setting) => {
      if (ejected)
        setting.addButton((button) =>
          button
            .setButtonText(m.settings_profile_document_open())
            .onClick(() => void openDocument(ctx, path)),
        );
      setting.addButton((button) =>
        button
          .setButtonText(
            ejected
              ? m.settings_profile_document_restore()
              : m.settings_profile_document_customize(),
          )
          .setDisabled(
            !ctx.profile.loaded ||
              !!ctx.settings.current?.["note.template-conversion-pending"],
          )
          .onClick(
            () =>
              void runAction(async () => {
                if (ejected) {
                  if (
                    await confirm(
                      {
                        title: m.settings_profile_document_restore_title(),
                        content: m.settings_profile_document_restore_desc({
                          path,
                        }),
                        action: m.settings_profile_document_restore_action(),
                        destructive: true,
                      },
                      ctx.app,
                    )
                  )
                    await ctx.profile.restoreDefault();
                } else
                  await ctx.app.workspace
                    .getLeaf(true)
                    .openFile(await ctx.profile.ejectDefault());
              }, ctx),
          ),
      );
    },
  };
}

function defaultProfileItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey>[] {
  return [
    {
      name: m.settings_profile_default_name(),
      desc: m.settings_profile_default_desc(),
    },
    {
      name: m.settings_profile_folder_name(),
      desc: m.settings_note_folder_desc(),
      control: {
        type: "folder",
        key: profileControlKey("default", "folder"),
        placeholder: defaultProfileBindingPlaceholder("note.literature-folder"),
      },
    },
    referencesStyleDefinition(ctx),
    {
      name: m.settings_note_import_folder_name(),
      desc: m.settings_note_import_folder_desc(),
      control: {
        type: "folder",
        key: profileControlKey("default", "import-folder"),
        placeholder: defaultProfileBindingPlaceholder("note.import-folder"),
      },
    },
    {
      name: m.settings_note_import_colored_highlights_name(),
      desc: m.settings_note_import_colored_highlights_desc(),
      control: {
        type: "toggle",
        key: profileControlKey("default", "colored-highlights"),
      },
    },
    {
      name: m.settings_note_import_annotations_template_name(),
      desc: m.settings_note_import_annotations_template_desc(),
      control: {
        type: "toggle",
        key: profileControlKey("default", "annotations-as-template"),
      },
    },
    defaultDocumentItem(ctx),
  ];
}

export function profileControlKey(
  id: "default",
  field: ProfileControlField,
): ProfileControlKey {
  return `note-profile:${id}:${field}`;
}
export function isProfileControlKey(key: string): key is ProfileControlKey {
  return (
    key.startsWith("note-profile:default:") &&
    key.slice("note-profile:default:".length) in bindingKeys
  );
}
export function getProfileControlValue(
  settings: SettingsService,
  key: ProfileControlKey,
): unknown {
  const field = key.slice(
    "note-profile:default:".length,
  ) as ProfileControlField;
  return (
    settings.current?.["note.default-profile"].bindings[bindingKeys[field]] ??
    ""
  );
}
export function setProfileControlValue(
  settings: SettingsService,
  key: ProfileControlKey,
  value: unknown,
): void {
  const field = key.slice(
    "note-profile:default:".length,
  ) as ProfileControlField;
  settings.updateDefaultLiteratureNoteProfileBindings({
    [bindingKeys[field]]:
      field === "colored-highlights" || field === "annotations-as-template"
        ? Boolean(value)
        : field === "citation-style" && value === ""
          ? null
          : String(value),
  });
}
