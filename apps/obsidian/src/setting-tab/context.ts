import type { App, PluginManifest } from "obsidian";

import type { CustomizeAction } from "@/services/local-bridge/customize";
import type { Settings } from "@/services/settings/schema";
import type { PluginSettings } from "@/services/settings/service";

import type { SettingTabShape } from "./effect-tab";

/** Settings keys, used to type declarative `control` bindings against the schema. */
export type SettingsKey = keyof Settings;
export type ProfileControlKey =
  `note-profile:default:${"folder" | "citation-style" | "import-folder" | "colored-highlights" | "annotations-as-template"}`;
export type SettingsControlKey = SettingsKey | ProfileControlKey;

/**
 * Shared dependencies every definition builder receives. Builders read services
 * lazily (inside `render`/predicate callbacks) so `getSettingDefinitions()`
 * itself stays cheap — it runs on every `update()` and once at registration for
 * search indexing.
 */
export interface SettingTabContext {
  /** Runs the tab's Effects on the tab layer's context and Scope. */
  tab: SettingTabShape;
  webWorkbenchEnabled: boolean;
  app: App;
  /**
   * The plugin's own manifest — its version and its folder in the vault. The
   * plugin object itself stays out of this context: its `services` getter is a
   * debug escape hatch that throws until `onload()` commits, and the first
   * `getSettingDefinitions()` runs inside `onload()`.
   */
  manifest: PluginManifest;
  settings: Pick<
    PluginSettings["Service"],
    | "current"
    | "update"
    | "updateDefaultLiteratureNoteProfileBindings"
    | "changes"
  >;
  /** The shared Customize flow the Template document row opens. */
  customize: CustomizeAction;
}
