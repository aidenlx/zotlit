import { type App } from "obsidian";

import { type DatabaseService } from "@/services/database/service";
import { type SettingsService } from "@/services/settings/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";
import { type ReleaseTabActions } from "@/setting-tab/context";
import type ZotLitPlugin from "@/zt-main";

/**
 * Backward-compatibility settings UI for Obsidian < 1.13.0, which has no
 * declarative `getSettingDefinitions()` API. This whole `compat/` folder is a
 * self-contained imperative re-implementation of the declarative tab built with
 * the legacy `Setting` / `display()` components. It is intentionally decoupled
 * from the declarative `setting-tab/*` modules so it can be deleted wholesale
 * once the supported `minAppVersion` reaches 1.13.0.
 *
 * Pre-1.13 has no sub-page navigation or list reorder affordances, so the tab
 * is rendered flat with `setHeading()` sections, and structural changes
 * re-render the whole tab via {@link CompatContext.rerender}.
 */
export interface CompatContext {
  app: App;
  plugin: ZotLitPlugin;
  settings: SettingsService;
  db: DatabaseService;
  zoteroPref: ZoteroPrefService;
  release: ReleaseTabActions;
  /** Rebuild the entire tab (pre-1.13 has no granular `update()`). */
  rerender: () => void;
  /**
   * Register a teardown callback run before the next rebuild and when the tab
   * is hidden. Use for event subscriptions wired up while a row is mounted.
   */
  defer: (cleanup: () => void) => void;
}
