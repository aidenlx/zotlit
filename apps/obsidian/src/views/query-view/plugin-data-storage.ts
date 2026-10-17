// A Query View host that keeps no file saves to plugin data: one settings key
// per host, written through the SettingsService. A host maps the view's text
// to the value it keeps; the Library View keeps its Library View Document.
//
// @see apps/obsidian/docs/adr/0070-the-library-view-is-a-fileless-query-view-host-that-saves-to-plugin-data.md
import type { Settings, SettingsService } from "@/services/settings/service";

import type { QueryViewHost } from "./view";

/** What the storage reads and writes of the settings. */
export type PluginDataSettings = Pick<SettingsService, "update" | "flush">;

/**
 * The save of a host that keeps its state under `key` in plugin data. A save
 * resolves once `data.json` holds the value, and rejects where the value or
 * the write failed, so the toolbar says the change is not saved.
 * @param value the value to keep for the view's new text, from the value
 * the key holds now.
 */
export function pluginDataStorage<K extends keyof Settings>(
  settings: PluginDataSettings,
  {
    key,
    value,
  }: { key: K; value: (text: string, stored: Settings[K]) => Settings[K] },
): Pick<QueryViewHost, "save"> {
  return {
    save: async (text) => {
      settings.update(
        (current) =>
          ({ [key]: value(text, current[key]) }) as Partial<Pick<Settings, K>>,
      );
      await settings.flush();
    },
  };
}
