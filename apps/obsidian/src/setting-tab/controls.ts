// The declarative `control` rows' storage: every control key reads and writes
// the settings store, encoded for the control that shows it.
import { Effect } from "effect";

import { PluginSettings } from "@/services/settings/service";
import type { SettingsPatch } from "@/services/settings/service";

import { decodeLogLevel, encodeLogLevel, LOG_LEVEL_KEY } from "./advanced";
import type { ProfileControlKey, SettingsKey } from "./context";
import { AUTO_TRIM_KEYS, decodeAutoTrim, encodeAutoTrim } from "./templates";

export type ProfileControlField =
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

export function isProfileControlKey(key: string): key is ProfileControlKey {
  return (
    key.startsWith("note-profile:default:") &&
    key.slice("note-profile:default:".length) in bindingKeys
  );
}

/** The default Profile binding a profile control shows. */
export function profileControlValue(key: ProfileControlKey) {
  const field = key.slice(
    "note-profile:default:".length,
  ) as ProfileControlField;
  return PluginSettings.use((settings) => settings.current).pipe(
    Effect.map(
      (current) =>
        current["note.default-profile"].bindings[bindingKeys[field]] ?? "",
    ),
  );
}

/** Store what a profile control set as the default Profile's binding. */
export function setProfileControlValue(key: ProfileControlKey, value: unknown) {
  const field = key.slice(
    "note-profile:default:".length,
  ) as ProfileControlField;
  return PluginSettings.use((settings) =>
    settings.updateDefaultLiteratureNoteProfileBindings({
      [bindingKeys[field]]:
        field === "colored-highlights" || field === "annotations-as-template"
          ? Boolean(value)
          : field === "citation-style" && value === ""
            ? null
            : String(value),
    }),
  );
}

/** A declarative `control`'s value, encoded for the control that shows it. */
export function controlValue(key: string) {
  if (isProfileControlKey(key)) return profileControlValue(key);
  return PluginSettings.use((settings) => settings.current).pipe(
    Effect.map((current) => {
      const value = current[key as SettingsKey];
      // Auto-trim stores `false | "nl" | "slurp"`; its dropdown reads a string.
      if (AUTO_TRIM_KEYS.has(key as SettingsKey)) return encodeAutoTrim(value);
      // Log level stores `LogLevel | null`; its dropdown reads a string.
      if (key === LOG_LEVEL_KEY) return encodeLogLevel(value);
      return value;
    }),
  );
}

/** Store a declarative `control`'s value, decoded from its control. */
export function writeControlValue(key: string, value: unknown) {
  if (isProfileControlKey(key)) return setProfileControlValue(key, value);
  const next = AUTO_TRIM_KEYS.has(key as SettingsKey)
    ? decodeAutoTrim(value)
    : key === LOG_LEVEL_KEY
      ? decodeLogLevel(value)
      : value;
  // `key` is constrained to schema keys by every `control` definition, and
  // `value` matches that key's control type, so the patch always validates.
  return PluginSettings.use((settings) =>
    settings.update({ [key]: next } as SettingsPatch),
  );
}
