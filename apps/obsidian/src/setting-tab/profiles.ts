// Declarative list, document lifecycle, and editor for Literature Note Profiles.

import { join } from "node:path/posix";
import type {
  Setting,
  SettingDefinitionItem,
  SettingDefinitionPage,
} from "obsidian";

import { synthesizeLegacyLiteratureNoteTemplate } from "@zotlit/templates/facade";

import { confirm } from "@/lib/confirm";
import { ensureFolder } from "@/lib/ensure-folder";
import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { DEFAULT_PROFILE, parseProfileSelector } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { DEFAULT_LITERATURE_NOTE_PROFILE } from "@/services/settings/schema";
import type {
  DefaultLiteratureNoteProfile,
  LiteratureNoteProfile,
} from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import {
  DEFAULT_FRONTMATTER_FIELDS,
  DEFAULT_TEMPLATES,
} from "@/services/template/defaults";
import { normalizeVaultPath } from "@/services/template/path";

import { referencesStyleDefinition } from "./citations";
import type {
  ProfileControlKey,
  SettingsControlKey,
  SettingTabContext,
} from "./context";
import { defaultProfileBindingPlaceholder } from "./placeholder";

type ProfileControlField =
  | "label"
  | "folder"
  | "citation-style-inherit"
  | "citation-style"
  | "import-folder"
  | "colored-highlights"
  | "annotations-as-template";
const PROFILE_CONTROL_PREFIX = "note-profile:";
const logger = getLogger(["setting-tab", "profiles"]);
const DEFAULT_DOCUMENT_REFERENCE = "literature-note-default.md";

export function literatureNoteProfileItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey>[] {
  const profiles = ctx.settings.current?.["note.profiles"] ?? [];
  const defaultProfile: DefaultLiteratureNoteProfile =
    ctx.settings.current?.["note.default-profile"] ??
    DEFAULT_LITERATURE_NOTE_PROFILE;

  return [
    {
      type: "page",
      name: m.settings_page_profiles(),
      desc: m.settings_page_profiles_desc(),
      items: [
        defaultProfilePage(ctx, defaultProfile.document),
        {
          type: "list",
          heading: m.settings_profile_heading(),
          addItem: {
            name: m.settings_profile_add(),
            action: (el) => addProfile(ctx, el),
          },
          onDelete: (index) => deleteProfile(ctx, profiles[index]),
          items: profiles.map((profile) => profilePage(ctx, profile)),
        },
      ],
    },
  ];
}

function addProfile(ctx: SettingTabContext, el: HTMLElement): void {
  el.blur();
  ctx.settings.createLiteratureNoteProfile(m.settings_profile_new_label());
  ctx.requestUpdate();
}

function deleteProfile(
  ctx: SettingTabContext,
  profile: LiteratureNoteProfile | undefined,
): void {
  if (!profile) return;
  void confirm(
    {
      title: m.settings_profile_delete_confirm_title({ label: profile.label }),
      content: m.settings_profile_delete_confirm_body(),
      action: m.settings_profile_delete(),
      destructive: true,
    },
    ctx.app,
  ).then((confirmed) => {
    if (!confirmed) return;
    ctx.settings.deleteLiteratureNoteProfile(profile.id);
    ctx.requestUpdate();
  });
}

function defaultProfilePage(
  ctx: SettingTabContext,
  document: string | undefined,
): SettingDefinitionPage<SettingsControlKey> {
  return {
    type: "page",
    name: m.settings_profile_default_name(),
    desc: m.settings_profile_default_desc(),
    displayValue: document ?? m.settings_profile_document_builtin(),
    items: [
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
          placeholder: defaultProfileBindingPlaceholder(
            "note.literature-folder",
          ),
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
      profileDocumentItem(ctx, { id: DEFAULT_PROFILE, document }),
    ],
  };
}

function profilePage(
  ctx: SettingTabContext,
  profile: LiteratureNoteProfile,
): SettingDefinitionPage<SettingsControlKey> {
  return {
    type: "page",
    name: profile.label,
    displayValue: m.settings_profile_display({
      folder:
        profile.bindings?.["note.literature-folder"] ??
        m.settings_profile_inherit(),
      style:
        profile.bindings?.["citation.references-style"] === null
          ? m.settings_profile_citation_style_default()
          : (profile.bindings?.["citation.references-style"] ??
            m.settings_profile_inherit()),
      document: profile.document ?? m.settings_profile_document_builtin(),
    }),
    items: [
      {
        name: m.settings_profile_name_name(),
        desc: m.settings_profile_name_desc(),
        control: {
          type: "text",
          key: profileControlKey(profile.id, "label"),
          validate: (label) =>
            label.trim() ? undefined : m.settings_profile_name_invalid(),
        },
      },
      {
        name: m.settings_profile_folder_name(),
        desc: m.settings_profile_folder_desc(),
        control: {
          type: "folder",
          key: profileControlKey(profile.id, "folder"),
          defaultValue: "",
          placeholder: m.settings_profile_inherit(),
        },
      },
      {
        name: m.settings_profile_citation_style_inherit_name(),
        desc: m.settings_profile_citation_style_inherit_desc(),
        control: {
          type: "toggle",
          key: profileControlKey(profile.id, "citation-style-inherit"),
        },
      },
      {
        name: m.settings_profile_citation_style_name(),
        desc: m.settings_profile_citation_style_desc(),
        visible: () =>
          profile.bindings?.["citation.references-style"] !== undefined,
        control: {
          type: "text",
          key: profileControlKey(profile.id, "citation-style"),
          defaultValue: "",
          placeholder: m.settings_profile_citation_style_default(),
        },
      },
      {
        name: m.settings_note_import_folder_name(),
        desc: m.settings_profile_import_folder_desc(),
        control: {
          type: "folder",
          key: profileControlKey(profile.id, "import-folder"),
          defaultValue: "",
          placeholder: m.settings_profile_inherit(),
        },
      },
      {
        name: m.settings_note_import_colored_highlights_name(),
        desc: m.settings_note_import_colored_highlights_desc(),
        control: {
          type: "dropdown",
          key: profileControlKey(profile.id, "colored-highlights"),
          options: inheritedBooleanOptions(),
        },
      },
      {
        name: m.settings_note_import_annotations_template_name(),
        desc: m.settings_note_import_annotations_template_desc(),
        control: {
          type: "dropdown",
          key: profileControlKey(profile.id, "annotations-as-template"),
          options: inheritedBooleanOptions(),
        },
      },
      profileDocumentItem(ctx, profile),
    ],
  };
}

function inheritedBooleanOptions(): Record<string, string> {
  return {
    inherit: m.settings_profile_inherit(),
    enabled: m.settings_profile_enabled(),
    disabled: m.settings_profile_disabled(),
  };
}

function profileDocumentItem(
  ctx: SettingTabContext,
  profile: Pick<LiteratureNoteProfile, "document"> & { id: ProfileSelector },
): SettingDefinitionItem<SettingsControlKey> {
  return {
    name: m.settings_profile_document_name(),
    desc: profileDocumentDescription(ctx, profile.document),
    render: (setting) => renderProfileDocument(setting, ctx, profile),
  };
}

function profileDocumentDescription(
  ctx: SettingTabContext,
  reference: string | undefined,
): string {
  if (!reference) return m.settings_profile_document_builtin_desc();
  let status;
  try {
    status = ctx.template
      .getLiteratureNoteTemplateStatuses()
      .find((candidate) => candidate.reference === reference);
  } catch {
    return m.settings_profile_document_custom({ path: reference });
  }
  if (!status) return m.settings_profile_document_missing({ path: reference });
  if (status.validation.state === "invalid") {
    return m.settings_profile_document_invalid({
      path: reference,
      error: status.validation.error.message,
    });
  }
  return m.settings_profile_document_custom({ path: status.path });
}

function renderProfileDocument(
  setting: Setting,
  ctx: SettingTabContext,
  profile: Pick<LiteratureNoteProfile, "document"> & { id: ProfileSelector },
): void {
  setting.setDesc(profileDocumentDescription(ctx, profile.document));
  if (!profile.document) {
    setting.addButton((button) =>
      button
        .setButtonText(m.settings_profile_document_customize())
        .setCta()
        .onClick(() => {
          button.buttonEl.blur();
          void customizeLiteratureNoteProfile(ctx, profile.id);
        }),
    );
    return;
  }

  const path = profileDocumentPath(ctx, profile.document);
  const file = ctx.app.vault.getFileByPath(path);
  if (file) {
    setting.addButton((button) =>
      button
        .setIcon("pencil")
        .setTooltip(m.settings_profile_document_open())
        .onClick(() => void ctx.app.workspace.getLeaf(true).openFile(file)),
    );
  }
  setting.addButton((button) =>
    button
      .setIcon("trash-2")
      .setTooltip(m.settings_profile_document_restore())
      .setDestructive()
      .onClick(() => {
        button.buttonEl.blur();
        void restoreBuiltInLiteratureNoteProfile(ctx, profile.id);
      }),
  );
}

export async function customizeLiteratureNoteProfile(
  ctx: SettingTabContext,
  profileId: ProfileSelector,
): Promise<void> {
  const reference =
    profileId === DEFAULT_PROFILE
      ? DEFAULT_DOCUMENT_REFERENCE
      : `literature-note-${profileId}.md`;
  const path = profileDocumentPath(ctx, reference);
  try {
    const source = builtInLiteratureNoteTemplate(ctx, profileId);
    let file = ctx.app.vault.getFileByPath(path);
    if (file) {
      const overwrite = await confirm(
        {
          title: m.settings_profile_document_overwrite_title({ path }),
          content: m.settings_profile_document_overwrite_desc(),
          action: m.settings_profile_document_overwrite_action(),
          destructive: true,
        },
        ctx.app,
      );
      if (!overwrite) return;
      await ctx.app.vault.modify(file, source);
    } else {
      const folder = normalizeVaultPath(
        ctx.settings.current?.["template.folder"] ?? "",
      );
      await ensureFolder(ctx.app, folder || "/");
      file = await ctx.app.vault.create(path, source);
    }
    setProfileDocument(ctx.settings, profileId, reference);
    ctx.requestUpdate();
    await ctx.app.workspace.getLeaf(true).openFile(file);
  } catch (error) {
    logger.error("Failed to customize Literature Note Profile", {
      profileId,
      error,
    });
    new BaseNotice(m.notice_profile_document_customize_failed());
  }
}

function builtInLiteratureNoteTemplate(
  ctx: SettingTabContext,
  profileId: ProfileSelector,
): string {
  const label =
    profileId === DEFAULT_PROFILE
      ? m.settings_profile_default_name()
      : (ctx.settings.current?.["note.profiles"].find(
          (profile) => profile.id === profileId,
        )?.label ?? m.settings_profile_new_label());
  return synthesizeLegacyLiteratureNoteTemplate(
    {
      note: { source: DEFAULT_TEMPLATES.note, language: "liquid" },
      content: { source: DEFAULT_TEMPLATES.content, language: "liquid" },
      filename: { source: DEFAULT_TEMPLATES.filename, language: "liquid" },
    },
    {
      id:
        profileId === DEFAULT_PROFILE
          ? "zotlit.default-profile"
          : `zotlit.profile.${profileId}`,
      name: label,
      description: m.settings_profile_document_seed_description(),
      frontmatter: DEFAULT_FRONTMATTER_FIELDS,
    },
  );
}

export async function restoreBuiltInLiteratureNoteProfile(
  ctx: SettingTabContext,
  profileId: ProfileSelector,
): Promise<void> {
  const profile = ctx.settings.getLiteratureNoteProfile(profileId);
  const reference =
    profile && "document" in profile ? profile.document : undefined;
  if (!reference) return;
  const confirmed = await confirm(
    {
      title: m.settings_profile_document_restore_title(),
      content: m.settings_profile_document_restore_desc({ path: reference }),
      action: m.settings_profile_document_restore_action(),
      destructive: true,
    },
    ctx.app,
  );
  if (!confirmed) return;

  try {
    const file = ctx.app.vault.getFileByPath(
      profileDocumentPath(ctx, reference),
    );
    if (file) await ctx.app.fileManager.trashFile(file);
    setProfileDocument(ctx.settings, profileId, null);
    ctx.requestUpdate();
  } catch (error) {
    logger.error("Failed to restore built-in Literature Note Template", {
      profileId,
      error,
    });
    new BaseNotice(m.notice_profile_document_restore_failed());
  }
}

function setProfileDocument(
  settings: SettingsService,
  profileId: ProfileSelector,
  reference: string | null,
): void {
  if (profileId === DEFAULT_PROFILE) {
    settings.setDefaultLiteratureNoteProfileDocument(reference);
  } else {
    settings.updateLiteratureNoteProfile(profileId, { document: reference });
  }
}

function profileDocumentPath(
  ctx: SettingTabContext,
  reference: string,
): string {
  return join(
    normalizeVaultPath(ctx.settings.current?.["template.folder"] ?? ""),
    reference,
  );
}

export function profileControlKey(
  id: string,
  field: ProfileControlField,
): ProfileControlKey {
  return `${PROFILE_CONTROL_PREFIX}${id}:${field}`;
}

export function isProfileControlKey(key: string): key is ProfileControlKey {
  return parseProfileControlKey(key) !== null;
}

export function getProfileControlValue(
  settings: SettingsService,
  key: ProfileControlKey,
): unknown {
  const { id, field } = parseProfileControlKey(key)!;
  const profile = settings.getLiteratureNoteProfile(id);
  if (!profile) return undefined;
  switch (field) {
    case "label":
      return "id" in profile ? profile.label : undefined;
    case "folder":
      return profile.bindings?.["note.literature-folder"] ?? "";
    case "citation-style-inherit":
      return (
        "id" in profile &&
        profile.bindings?.["citation.references-style"] === undefined
      );
    case "citation-style":
      return profile.bindings?.["citation.references-style"] ?? "";
    case "import-folder":
      return profile.bindings?.["note.import-folder"] ?? "";
    case "colored-highlights":
      return "id" in profile
        ? encodeInheritedBoolean(
            profile.bindings?.["note.import-colored-highlights"],
          )
        : (profile.bindings?.["note.import-colored-highlights"] ?? false);
    case "annotations-as-template":
      return "id" in profile
        ? encodeInheritedBoolean(
            profile.bindings?.["note.import-annotations-as-template"],
          )
        : (profile.bindings?.["note.import-annotations-as-template"] ?? false);
  }
}

function encodeInheritedBoolean(value: boolean | undefined): string {
  if (value === undefined) return "inherit";
  return value ? "enabled" : "disabled";
}

export function setProfileControlValue(
  settings: SettingsService,
  key: ProfileControlKey,
  value: unknown,
): void {
  const { id, field } = parseProfileControlKey(key)!;
  const profile = settings.getLiteratureNoteProfile(id);
  if (!profile) return;
  if (!("id" in profile)) {
    if (field === "folder") {
      settings.updateDefaultLiteratureNoteProfileBindings({
        "note.literature-folder": String(value),
      });
    } else if (field === "citation-style") {
      settings.updateDefaultLiteratureNoteProfileBindings({
        "citation.references-style": value === "" ? null : String(value),
      });
    } else if (field === "import-folder") {
      settings.updateDefaultLiteratureNoteProfileBindings({
        "note.import-folder": String(value),
      });
    } else if (field === "colored-highlights") {
      settings.updateDefaultLiteratureNoteProfileBindings({
        "note.import-colored-highlights": Boolean(value),
      });
    } else if (field === "annotations-as-template") {
      settings.updateDefaultLiteratureNoteProfileBindings({
        "note.import-annotations-as-template": Boolean(value),
      });
    }
    return;
  }
  if (field === "label") {
    settings.updateLiteratureNoteProfile(id, { label: String(value) });
    return;
  }

  const bindings = { ...profile.bindings };
  if (field === "citation-style-inherit") {
    if (value) delete bindings["citation.references-style"];
    else if (bindings["citation.references-style"] === undefined) {
      bindings["citation.references-style"] = null;
    }
    settings.updateLiteratureNoteProfile(id, { bindings });
    return;
  }
  if (field === "folder") {
    if (value === "") delete bindings["note.literature-folder"];
    else bindings["note.literature-folder"] = String(value);
  } else if (field === "import-folder") {
    if (value === "") delete bindings["note.import-folder"];
    else bindings["note.import-folder"] = String(value);
  } else if (field === "colored-highlights") {
    if (value === "inherit") delete bindings["note.import-colored-highlights"];
    else bindings["note.import-colored-highlights"] = value === "enabled";
  } else if (field === "annotations-as-template") {
    if (value === "inherit") {
      delete bindings["note.import-annotations-as-template"];
    } else {
      bindings["note.import-annotations-as-template"] = value === "enabled";
    }
  } else if (value === "") {
    bindings["citation.references-style"] = null;
  } else {
    bindings["citation.references-style"] = String(value);
  }
  settings.updateLiteratureNoteProfile(id, { bindings });
}

function parseProfileControlKey(
  key: string,
): { id: ProfileSelector; field: ProfileControlField } | null {
  if (!key.startsWith(PROFILE_CONTROL_PREFIX)) return null;
  const value = key.slice(PROFILE_CONTROL_PREFIX.length);
  const separator = value.lastIndexOf(":");
  if (separator < 1) return null;
  // Keys are built only from `profileControlKey(DEFAULT_PROFILE | ProfileId, …)`.
  const id = parseProfileSelector(value.slice(0, separator));
  if (id === undefined) return null;
  const field = value.slice(separator + 1);
  if (
    field !== "label" &&
    field !== "folder" &&
    field !== "citation-style-inherit" &&
    field !== "citation-style" &&
    field !== "import-folder" &&
    field !== "colored-highlights" &&
    field !== "annotations-as-template"
  ) {
    return null;
  }
  return { id, field };
}
