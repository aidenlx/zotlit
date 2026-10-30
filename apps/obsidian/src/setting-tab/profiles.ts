// The default Profile's main-page rows and the Literature note profiles page.
import { Effect, Schema } from "effect";
import { Menu } from "obsidian";
import type {
  SettingDefinitionItem,
  SettingDefinitionList,
  SettingDefinitionPage,
} from "obsidian";

import { awaitConfirm } from "@/lib/confirm";
import { awaitModal } from "@/lib/effect-modal";
import * as m from "@/lib/i18n/generated/messages";
import { showMenuAtButton } from "@/lib/menu";
import { FileManager } from "@/lib/obsidian-file-manager";
import { Vault } from "@/lib/obsidian-vault";
import { leaveSettingsFor } from "@/lib/plugin-host";
import { DEFAULT_PROFILE } from "@/lib/profile-stamp";
import type { ProfileId } from "@/lib/profile-stamp";
import { Customize } from "@/services/local-bridge/customize";
import { installedStyles } from "@/services/note-feature/creation-view";
import { Profile } from "@/services/profile/service";
import { PluginSettings } from "@/services/settings/service";
import { explainWorkbenchOpen } from "@/views/template-workbench/actions";
import { openNativeProfile } from "@/views/template-workbench/open";

import { referencesStyleDefinition } from "./citations";
import type {
  ProfileControlKey,
  SettingsControlKey,
  SettingTabContext,
} from "./context";
import type { ProfileControlField } from "./controls";
import { openProfileDeletion } from "./delete-profile-modal";
import type { ProfileDeletionConsent } from "./delete-profile-modal";
import { duplicateProfileToWorkbench } from "./duplicate-profile";
import { SettingTab } from "./effect-tab";
import type { SettingTabEnv } from "./effect-tab";
import { defaultProfileBindingPlaceholder } from "./placeholder";
import {
  addProfileDestination,
  importProfileDialog,
  shareProfile,
} from "./profile-dialogs";
import { partialItems } from "./templates";

/** The excluded document left the excluded list before its delete. */
export class ExcludedDocumentChanged extends Schema.TaggedError<
  ExcludedDocumentChanged,
  { readonly brand: unique symbol }
>()("ExcludedDocumentChanged", { path: Schema.String }) {
  override get message(): string {
    return m.profile_import_changed();
  }
}

/**
 * Profile file actions wait for the registry to load and stay locked while the
 * legacy template conversion is pending, so no document is written mid-flight.
 */
function profileActionsLocked(ctx: SettingTabContext): boolean {
  return ctx.tab.sync(
    Effect.gen(function* () {
      const loaded = yield* (yield* Profile).loaded;
      const settings = yield* (yield* PluginSettings).current;
      return !loaded || !!settings["note.template-conversion-pending"];
    }),
  );
}

/** Whether the vault holds the saved Default document. */
function defaultDocumentEjected(ctx: SettingTabContext): boolean {
  return ctx.tab.sync(
    Effect.gen(function* () {
      const path = yield* (yield* Profile).defaultDocumentPath;
      return (yield* (yield* Vault).getFileByPath(path)) !== null;
    }),
  );
}

/**
 * Start a Profile row's action. A failure shows the failure notice; the tab
 * rebuilds once the action ends, since it may have changed the Profiles.
 */
function runAction<A, E>(
  ctx: SettingTabContext,
  action: Effect.Effect<A, E, SettingTabEnv>,
): void {
  void ctx.tab.run(
    action.pipe(Effect.andThen(SettingTab.use((tab) => tab.update))),
    m.settings_failed_profile(),
  );
}

/** Open a Profile in the configured workbench. */
function customize(profileId: ProfileId | typeof DEFAULT_PROFILE) {
  return Customize.use((flow) => flow.open({ profileId }));
}

/**
 * The main-page rows of the default Profile: both note folders it binds, then
 * its citation style and document actions. No heading names the default Profile
 * here — that happens on the Profiles page. Its other Imported Note bindings
 * sit on the Imported notes page.
 */
export function literatureNoteItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey>[] {
  return [
    {
      id: "settings_profile_folder",
      name: m.settings_profile_folder_name(),
      desc: m.settings_note_folder_desc(),
      control: {
        type: "folder",
        key: profileControlKey("default", "folder"),
        placeholder: defaultProfileBindingPlaceholder("note.literature-folder"),
      },
    },
    {
      id: "settings_note_import_folder",
      name: m.settings_note_import_folder_name(),
      desc: m.settings_note_import_folder_desc(),
      control: {
        type: "folder",
        key: profileControlKey("default", "import-folder"),
        placeholder: defaultProfileBindingPlaceholder("note.import-folder"),
      },
    },
    referencesStyleDefinition(ctx),
    defaultDocumentItem(ctx),
  ];
}

/**
 * The "Literature note profiles" page: the default Profile as a row of its own,
 * then the Profile documents as a list, then the Partials every Profile shares,
 * then the documents ZotLit refused to load. Editing a Profile means editing
 * its document.
 */
export function profilesPage(
  ctx: SettingTabContext,
): SettingDefinitionPage<SettingsControlKey> {
  return {
    type: "page",
    id: "settings_page_profiles",
    name: m.settings_page_profiles(),
    desc: m.settings_page_profiles_desc(),
    items: [
      defaultProfileItem(ctx),
      profilesList(ctx),
      ...partialItems(ctx),
      ...excludedDocumentItems(ctx),
    ],
  };
}

/**
 * The Profiles themselves, one row per document. Add and Import are the list
 * header's own affordances, so each row carries only what acts on that Profile:
 * edit opens the workbench; the menu holds duplicate, share, and delete.
 */
function profilesList(
  ctx: SettingTabContext,
): SettingDefinitionList<SettingsControlKey> {
  const profiles = ctx.tab.sync(Profile.use((profile) => profile.profiles));
  const locked = profileActionsLocked(ctx);
  return {
    type: "list",
    id: "settings_profile_other",
    heading: m.settings_profile_other_heading(),
    emptyState: m.settings_profile_empty_desc(),
    // Both ways in stay out of the header while a document write would race the
    // registry load or the pending template conversion.
    addItem: locked
      ? undefined
      : {
          name: m.settings_profile_add(),
          action: () => runAction(ctx, addProfileDestination(ctx.app)),
        },
    extraButtons: locked
      ? undefined
      : [
          (button) =>
            button
              .setIcon("import")
              .setTooltip(m.command_import_profile_name())
              .onClick(() => runAction(ctx, importProfileDialog(ctx.app))),
        ],
    items: profiles.map((profile) => ({
      id: `settings_profile_entry:${profile.id}`,
      name: profile.label,
      desc: m.settings_profile_match_status({ state: profile.match.state }),
      searchable: false,
      render: (setting) => {
        setting.addButton((button) =>
          button
            .setIcon("pencil")
            .setTooltip(m.settings_profile_edit())
            .setDisabled(locked)
            .onClick(() => runAction(ctx, customize(profile.id))),
        );
        setting.addExtraButton((button) =>
          button
            .setIcon("more-horizontal")
            .setTooltip(m.workbench_more_actions())
            .onClick(() => {
              const menu = new Menu();
              menu.addItem((item) =>
                item
                  .setTitle(m.settings_profile_duplicate())
                  .setIcon("copy")
                  .setDisabled(locked)
                  .onClick(() =>
                    runAction(ctx, duplicateProfileToWorkbench(profile.id)),
                  ),
              );
              menu.addItem((item) =>
                item
                  .setTitle(m.settings_profile_share())
                  .setIcon("share")
                  .setDisabled(locked)
                  .onClick(() =>
                    runAction(ctx, shareProfile(ctx.app, profile.id)),
                  ),
              );
              menu.addSeparator();
              menu.addItem((item) =>
                item
                  .setTitle(m.settings_profile_delete())
                  .setIcon("trash-2")
                  .setWarning(true)
                  .setDisabled(locked)
                  .onClick(() =>
                    runAction(ctx, deleteProfile(ctx, profile.id)),
                  ),
              );
              showMenuAtButton(menu, button.extraSettingsEl);
            }),
        );
      },
    })),
  };
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
    ...Map.groupBy(
      ctx.tab.sync(Profile.use((profile) => profile.diagnostics)),
      ({ path }) => path,
    ).values(),
  ].map(
    (group) =>
      group.find(({ code }) => code === "duplicate-profile-id") ?? group[0]!,
  );
  if (diagnostics.length === 0) return [];
  return [
    ...(diagnostics.some(({ code }) => code === "duplicate-profile-id")
      ? [
          {
            id: "settings_profile_duplicate_id",
            name: m.settings_profile_duplicate_id_name(),
            desc: warning(m.settings_profile_duplicate_banner()),
          },
        ]
      : []),
    {
      type: "list",
      id: "settings_profile_excluded",
      heading: m.settings_profile_excluded_heading(),
      onDelete: (index) => {
        const diagnostic = diagnostics[index];
        if (diagnostic)
          runAction(ctx, deleteExcludedProfileDocument(ctx, diagnostic.path));
      },
      items: diagnostics.map((diagnostic) => ({
        id: `settings_profile_excluded_entry:${diagnostic.path}`,
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
              .onClick(() =>
                runAction(ctx, openDocument(ctx, diagnostic.path)),
              ),
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

function deleteExcludedProfileDocument(ctx: SettingTabContext, path: string) {
  return Effect.gen(function* () {
    const accepted = yield* awaitConfirm(
      {
        title: m.settings_profile_excluded_delete(),
        content: m.settings_profile_delete_confirm_body(),
        action: m.settings_profile_delete(),
        destructive: true,
      },
      ctx.app,
    );
    if (!accepted) return;
    const diagnostics = yield* (yield* Profile).diagnostics;
    if (!diagnostics.some((diagnostic) => diagnostic.path === path))
      return yield* new ExcludedDocumentChanged({ path });
    const file = yield* (yield* Vault).getFileByPath(path);
    if (file) yield* (yield* FileManager).trashFile(file);
  });
}

function openDocument(ctx: SettingTabContext, path: string) {
  return Effect.gen(function* () {
    const file = yield* (yield* Vault).getFileByPath(path);
    if (!file) return;
    yield* explainWorkbenchOpen(
      yield* leaveSettingsFor(openNativeProfile(file, { customize: true })),
    );
  });
}

function deleteProfile(ctx: SettingTabContext, id: ProfileId) {
  return Effect.gen(function* () {
    const profile = yield* Profile;
    const plan = yield* profile.prepareDelete(id);
    const styles =
      plan.literatureNotes.length + plan.importedNotes.length
        ? yield* installedStyles
        : [];
    const consent = yield* awaitModal<ProfileDeletionConsent | undefined>(
      (resolve) => openProfileDeletion(ctx.app, { plan, styles }, resolve),
    );
    if (consent)
      yield* profile.delete(id, consent.target, { move: consent.move });
  });
}

/** Confirm before replacing the saved Default with the built-in template. */
function restoreDefaultProfile(ctx: SettingTabContext) {
  return Effect.gen(function* () {
    const profile = yield* Profile;
    const path = yield* profile.defaultDocumentPath;
    const confirmed = yield* awaitConfirm(
      {
        title: m.settings_profile_document_restore_title(),
        content: m.settings_profile_document_restore_desc({ path }),
        action: m.settings_profile_document_restore_action(),
        destructive: true,
      },
      ctx.app,
    );
    if (confirmed) yield* profile.restoreDefault;
  });
}

/**
 * Templates and properties share one workbench entry; a saved Default also
 * offers Restore built-in.
 */
function defaultDocumentItem(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey> {
  const ejected = defaultDocumentEjected(ctx);
  return {
    id: "settings_profile_document",
    name: m.settings_profile_document_name(),
    desc: m.settings_profile_document_desc(),
    render: (setting) => {
      if (ejected)
        setting.addButton((button) =>
          button
            .setIcon("rotate-ccw")
            .setTooltip(m.settings_profile_document_restore())
            .setDisabled(profileActionsLocked(ctx))
            .setDestructive()
            .onClick(() => runAction(ctx, restoreDefaultProfile(ctx))),
        );
      setting.addButton((button) =>
        button
          .setIcon("pencil")
          .setTooltip(m.settings_profile_edit())
          .setDisabled(profileActionsLocked(ctx))
          .onClick(() => runAction(ctx, customize(DEFAULT_PROFILE))),
      );
    },
  };
}

/**
 * The Default row of the Profiles page: named there, above the other Profiles.
 * Customize opens its effective source. Duplicating Default carries no bindings and copies
 * its document verbatim, so the copy differs from Default in nothing — the very
 * profile `prepareCreate` refuses to mint. Add profile is that path.
 */
function defaultProfileItem(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey> {
  return {
    id: "settings_profile_default",
    name: m.settings_profile_default_name(),
    desc: m.settings_profile_default_desc(),
    render: (setting) => {
      setting.addButton((button) =>
        button
          .setIcon("pencil")
          .setTooltip(m.settings_profile_edit())
          .setDisabled(profileActionsLocked(ctx))
          .onClick(() => runAction(ctx, customize(DEFAULT_PROFILE))),
      );

      setting.addExtraButton((button) =>
        button
          .setIcon("more-horizontal")
          .setTooltip(m.workbench_more_actions())
          .setDisabled(profileActionsLocked(ctx))
          .onClick(() => {
            const menu = new Menu();
            menu.addItem((item) =>
              item
                .setTitle(m.settings_profile_share())
                .setIcon("share")
                .onClick(() =>
                  runAction(ctx, shareProfile(ctx.app, "default")),
                ),
            );
            if (defaultDocumentEjected(ctx)) {
              menu.addSeparator();
              menu.addItem((item) =>
                item
                  .setTitle(m.settings_profile_document_restore())
                  .setIcon("rotate-ccw")
                  .setWarning(true)
                  .onClick(() => runAction(ctx, restoreDefaultProfile(ctx))),
              );
            }
            showMenuAtButton(menu, button.extraSettingsEl);
          }),
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
