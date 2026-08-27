// Declarative list and editor for added Literature Note Profiles.

import type { SettingDefinitionItem, SettingDefinitionPage } from "obsidian";

import { confirm } from "@/lib/confirm";
import * as m from "@/lib/i18n/generated/messages";
import type { LiteratureNoteProfile } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";

import type {
  ProfileControlKey,
  SettingsControlKey,
  SettingTabContext,
} from "./context";

type ProfileControlField = "label" | "folder" | "citation-style";
const PROFILE_CONTROL_PREFIX = "note-profile:";

export function literatureNoteProfileItems(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey>[] {
  const profiles = ctx.settings.current?.["note.profiles"] ?? [];
  if (profiles.length === 0) return [addFirstProfileItem(ctx)];

  return [
    {
      type: "page",
      name: m.settings_page_profiles(),
      desc: m.settings_page_profiles_desc(),
      items: [
        {
          name: m.settings_profile_default_name(),
          desc: m.settings_profile_default_desc(),
        },
        {
          type: "list",
          heading: m.settings_profile_heading(),
          addItem: {
            name: m.settings_profile_add(),
            action: (el) => addProfile(ctx, el),
          },
          onDelete: (index) => deleteProfile(ctx, profiles[index]),
          items: profiles.map(profilePage),
        },
      ],
    },
  ];
}

function addFirstProfileItem(
  ctx: SettingTabContext,
): SettingDefinitionItem<SettingsControlKey> {
  return {
    name: m.settings_note_add_setup_name(),
    desc: m.settings_note_add_setup_desc(),
    action: (el) => addProfile(ctx, el),
  };
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

function profilePage(
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
        profile.bindings?.["citation.references-style"] ??
        m.settings_profile_inherit(),
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
        name: m.settings_profile_citation_style_name(),
        desc: m.settings_profile_citation_style_desc(),
        control: {
          type: "text",
          key: profileControlKey(profile.id, "citation-style"),
          defaultValue: "",
          placeholder: m.settings_profile_inherit(),
        },
      },
    ],
  };
}

function profileControlKey(
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
  if (!profile || !("id" in profile)) return undefined;
  switch (field) {
    case "label":
      return profile.label;
    case "folder":
      return profile.bindings?.["note.literature-folder"] ?? "";
    case "citation-style":
      return profile.bindings?.["citation.references-style"] ?? "";
  }
}

export function setProfileControlValue(
  settings: SettingsService,
  key: ProfileControlKey,
  value: unknown,
): void {
  const { id, field } = parseProfileControlKey(key)!;
  const profile = settings.getLiteratureNoteProfile(id);
  if (!profile || !("id" in profile)) return;
  if (field === "label") {
    settings.updateLiteratureNoteProfile(id, { label: String(value) });
    return;
  }

  const bindings = { ...profile.bindings };
  const bindingKey =
    field === "folder" ? "note.literature-folder" : "citation.references-style";
  if (value === "") delete bindings[bindingKey];
  else bindings[bindingKey] = String(value);
  settings.updateLiteratureNoteProfile(id, { bindings });
}

function parseProfileControlKey(
  key: string,
): { id: string; field: ProfileControlField } | null {
  if (!key.startsWith(PROFILE_CONTROL_PREFIX)) return null;
  const value = key.slice(PROFILE_CONTROL_PREFIX.length);
  const separator = value.lastIndexOf(":");
  if (separator < 1) return null;
  const id = value.slice(0, separator);
  const field = value.slice(separator + 1);
  if (field !== "label" && field !== "folder" && field !== "citation-style") {
    return null;
  }
  return { id, field };
}
