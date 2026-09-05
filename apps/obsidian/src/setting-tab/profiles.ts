// The default Profile's main-page rows and the Literature note profiles page.
import { basename } from "node:path/posix";
import type {
  SettingDefinitionItem,
  SettingDefinitionList,
  SettingDefinitionPage,
} from "obsidian";

import { confirm } from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import type { ProfileId } from "@/lib/profile-stamp";
import { listInstalledStyles } from "@/services/pandoc/styles";
import type { SettingsService } from "@/services/settings/service";

import { referencesStyleDefinition } from "./citations";
import type {
  ProfileControlKey,
  SettingsControlKey,
  SettingTabContext,
} from "./context";
export {
  createProfileCreator,
  loadProfilePreviewData,
  type ProfileDialogServices,
  createProfileDialog,
  renderProfileCreatedNotice,
  CreateProfileModal,
  type CreateProfile,
  type CreateProfileOptions,
  type CreatedProfile,
  type ProfileCreationDeps,
  type ProfileCreationData,
} from "./create-profile-modal";
export {
  createProfileImporter,
  importProfileDialog,
  ImportProfileModal,
  profileImportNotice,
  type ImportProfile,
  type ImportProfileDeps,
} from "./import-profile-modal";
import { duplicateProfileToEditor } from "./duplicate-profile";
export { duplicateProfileToEditor } from "./duplicate-profile";
import { confirmProfileDeletion } from "./delete-profile-modal";
export {
  confirmProfileDeletion,
  type ProfileDeletionConsent,
} from "./delete-profile-modal";
import { highlightMappingItems } from "./note-import";
import { defaultProfileBindingPlaceholder } from "./placeholder";
import { shareProfile } from "./share-profile-modal";
export { shareProfile, ShareProfileModal } from "./share-profile-modal";

const logger = getLogger(["setting-tab", "profiles"]);

/**
 * Profile file actions wait for the registry to load and stay locked while the
 * legacy template conversion is pending, so no document is written mid-flight.
 */
function profileActionsLocked(ctx: SettingTabContext): boolean {
  return (
    !ctx.profile.loaded ||
    !!ctx.settings.current?.["note.template-conversion-pending"]
  );
}
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

/**
 * The main-page rows of the default Profile: its Literature Note bindings and
 * document actions, then the Imported Note bindings as their own group. No
 * heading names the default Profile here — that happens on the Profiles page.
 */
export function literatureNoteItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey>[] {
  return [
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
    defaultDocumentItem(ctx),
    propertiesItem(ctx),
    {
      type: "group",
      heading: m.settings_imported_notes_heading(),
      items: [
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
          type: "page",
          name: m.settings_note_import_highlight_mappings_name(),
          desc: m.settings_note_import_highlight_mappings_desc(),
          items: highlightMappingItems(ctx),
        },
        {
          name: m.settings_note_import_annotations_template_name(),
          desc: m.settings_note_import_annotations_template_desc(),
          control: {
            type: "toggle",
            key: profileControlKey("default", "annotations-as-template"),
          },
        },
      ],
    },
  ];
}

/**
 * The "Literature note profiles" page: the default Profile as a row of its own,
 * then the Profile documents as a list, then the documents ZotLit refused to
 * load. Editing a Profile means editing its document.
 */
export function profilesPage(
  ctx: SettingTabContext,
): SettingDefinitionPage<SettingsControlKey> {
  return {
    type: "page",
    name: m.settings_page_profiles(),
    desc: m.settings_page_profiles_desc(),
    items: [
      defaultProfileItem(ctx),
      profilesList(ctx),
      ...excludedDocumentItems(ctx),
    ],
  };
}

/**
 * The Profiles themselves, one row per document. Add and Import are the list
 * header's own affordances, so each row carries only what acts on that Profile:
 * open, duplicate, and share as icons, with delete as the list's own control.
 */
function profilesList(
  ctx: SettingTabContext,
): SettingDefinitionList<SettingsControlKey> {
  const profiles = ctx.profile.profiles;
  const locked = profileActionsLocked(ctx);
  return {
    type: "list",
    heading: m.settings_profile_other_heading(),
    emptyState: m.settings_profile_empty_desc(),
    // Both ways in stay out of the header while a document write would race the
    // registry load or the pending template conversion.
    addItem: locked
      ? undefined
      : {
          name: m.settings_profile_add(),
          // A Profile is its document, so adding one copies Default's and opens
          // it with the name selected. There is nothing to ask up front.
          action: () =>
            void runAction(
              () =>
                duplicateProfileToEditor(ctx, "default", {
                  label: nextProfileLabel(ctx),
                }),
              ctx,
            ),
        },
    extraButtons: locked
      ? undefined
      : [
          (button) =>
            button
              .setIcon("import")
              .setTooltip(m.command_import_profile_name())
              .onClick(
                () =>
                  void runAction(async () => {
                    await ctx.importProfile();
                  }, ctx),
              ),
        ],
    onDelete: (index) => {
      const profile = profiles[index];
      if (profile) void deleteProfile(ctx, profile.id);
    },
    items: profiles.map((profile) => ({
      name: profile.label,
      // Its document names it: that file is what every icon on the row acts on,
      // and it is what tells two Profiles of the same label apart.
      desc: profile.document,
      searchable: false,
      render: (setting) => {
        setting.addExtraButton((button) =>
          button
            .setIcon("pencil")
            .setTooltip(m.settings_template_open())
            .onClick(() => void openDocument(ctx, profile.path)),
        );
        setting.addExtraButton((button) =>
          button
            .setIcon("copy")
            .setTooltip(m.settings_profile_duplicate())
            .onClick(
              () =>
                void runAction(
                  () => duplicateProfileToEditor(ctx, profile.id),
                  ctx,
                ),
            ),
        );
        setting.addExtraButton((button) =>
          button
            .setIcon("share")
            .setTooltip(m.settings_profile_share())
            .onClick(
              () => void runAction(() => shareProfile(ctx, profile.id), ctx),
            ),
        );
      },
    })),
  };
}

/** The first unused "Profile n", so adding one asks the user nothing. */
function nextProfileLabel(ctx: SettingTabContext): string {
  const taken = new Set(
    ctx.profile.profiles.map((profile) => profile.label.toLocaleLowerCase()),
  );
  let number = 1;
  while (
    taken.has(m.settings_profile_numbered_name({ number }).toLocaleLowerCase())
  )
    number++;
  return m.settings_profile_numbered_name({ number });
}

/**
 * The Profile documents ZotLit refused to load, listed apart from the working
 * Profiles so the two are never read as one collection. The section is absent
 * while every document loads.
 */
function excludedDocumentItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey>[] {
  // One row per document: a repeated ID is the reason worth naming when a
  // document carries more than one complaint.
  const diagnostics = [
    ...Map.groupBy(ctx.profile.diagnostics, ({ path }) => path).values(),
  ].map(
    (group) =>
      group.find(({ code }) => code === "duplicate-profile-id") ?? group[0]!,
  );
  if (diagnostics.length === 0) return [];
  return [
    ...(diagnostics.some(({ code }) => code === "duplicate-profile-id")
      ? [
          {
            name: m.settings_profile_duplicate_id_name(),
            desc: warning(m.settings_profile_duplicate_banner()),
          },
        ]
      : []),
    {
      type: "list",
      heading: m.settings_profile_excluded_heading(),
      onDelete: (index) => {
        const diagnostic = diagnostics[index];
        if (diagnostic)
          void deleteExcludedProfileDocument(ctx, diagnostic.path);
      },
      items: diagnostics.map((diagnostic) => ({
        name: diagnostic.path,
        desc:
          diagnostic.code === "duplicate-profile-id"
            ? undefined
            : m.settings_profile_document_invalid({
                error:
                  diagnostic.reason === "invalid-profile-id"
                    ? m.settings_profile_id_invalid()
                    : diagnostic.message,
              }),
        searchable: false,
        render: (setting) => {
          setting.addExtraButton((button) =>
            button
              .setIcon("pencil")
              .setTooltip(m.settings_template_open())
              .onClick(() => void openDocument(ctx, diagnostic.path)),
          );
        },
      })),
    },
  ];
}

/** A description that reads as a warning, as the Library scope rows do. */
function warning(text: string): DocumentFragment {
  const desc = createFragment();
  desc.append(createSpan({ cls: "mod-warning", text }));
  return desc;
}

async function deleteExcludedProfileDocument(
  ctx: SettingTabContext,
  path: string,
): Promise<void> {
  const accepted = await confirm(
    {
      title: m.settings_profile_excluded_delete(),
      content: m.settings_profile_delete_confirm_body(),
      action: m.settings_profile_delete(),
      destructive: true,
    },
    ctx.app,
  );
  if (!accepted) return;
  await runAction(async () => {
    if (!ctx.profile.diagnostics.some((diagnostic) => diagnostic.path === path))
      throw new Error(m.profile_import_changed());
    const file = ctx.app.vault.getFileByPath(path);
    if (file) await ctx.app.fileManager.trashFile(file);
  }, ctx);
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
  await runAction(async () => {
    const plan = await ctx.profile.prepareDelete(id);
    const styles =
      plan.literatureNotes.length + plan.importedNotes.length &&
      ctx.zoteroPref.dataDir
        ? await listInstalledStyles(ctx.zoteroPref.dataDir)
        : [];
    const consent = await confirmProfileDeletion(ctx.app, { plan, styles });
    if (consent)
      await ctx.profile.delete(id, consent.target, { move: consent.move });
  }, ctx);
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
            .setIcon("pencil")
            .setTooltip(m.settings_template_open())
            .onClick(() => void openDocument(ctx, path)),
        );
      setting.addButton((button) =>
        button
          // Restoring trashes the ejected file so the built-in takes over
          // again — a revert, which is why it is not the delete glyph.
          .setIcon(ejected ? "rotate-ccw" : "file-pen")
          .setTooltip(
            ejected
              ? m.settings_profile_document_restore()
              : m.settings_template_eject(),
          )
          .setDisabled(profileActionsLocked(ctx))
          .then((button) => {
            if (ejected) button.setDestructive();
          })
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

/**
 * The Default row of the Profiles page: named there, above the other Profiles.
 * Sharing is its one action. Duplicating Default carries no bindings and copies
 * its document verbatim, so the copy differs from Default in nothing — the very
 * profile `prepareCreate` refuses to mint. Add profile is that path.
 */
function defaultProfileItem(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey> {
  return {
    name: m.settings_profile_default_name(),
    desc: m.settings_profile_default_desc(),
    render: (setting) => {
      setting.addExtraButton((button) =>
        button
          .setIcon("share")
          .setTooltip(m.settings_profile_share())
          .setDisabled(profileActionsLocked(ctx))
          .onClick(
            () => void runAction(() => shareProfile(ctx, "default"), ctx),
          ),
      );
    },
  };
}

/**
 * Managed Frontmatter has one editor, the template document. While the default
 * look is built in, the row offers the eject (which carries the current fields
 * along); once ejected, it opens the document.
 */
function propertiesItem(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey> {
  const path = ctx.profile.defaultDocumentPath;
  const ejected = ctx.app.vault.getFileByPath(path) !== null;
  return {
    name: m.settings_profile_properties_name(),
    desc: ejected
      ? m.settings_profile_properties_desc()
      : m.settings_profile_properties_builtin_desc(),
    render: (setting) => {
      setting.addButton((button) =>
        button
          .setIcon(ejected ? "pencil" : "file-pen")
          .setTooltip(
            ejected ? m.settings_template_open() : m.settings_template_eject(),
          )
          .setDisabled(profileActionsLocked(ctx))
          .onClick(
            () =>
              void runAction(async () => {
                if (ejected) await openDocument(ctx, path);
                else
                  await ctx.app.workspace
                    .getLeaf(true)
                    .openFile(await ctx.profile.ejectDefault());
              }, ctx),
          ),
      );
    },
  };
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
