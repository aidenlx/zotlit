import type { App, PluginManifest } from "obsidian";

import type { PlainLibraryScope } from "@/services/library-scope/plain";
import type { CustomizeAction } from "@/services/local-bridge/customize";
import type { PlainProfile } from "@/services/profile/plain";
import type { Settings } from "@/services/settings/schema";
import type { PluginSettings } from "@/services/settings/service";
import type { PlainTemplate } from "@/services/template/plain";
import type { PlainZoteroPref } from "@/services/zotero-pref/plain";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";

import type { SettingTabShape } from "./effect-tab";
import type { ImportProfile } from "./import-profile-modal";

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
  importProfile: ImportProfile;
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
  profile: Pick<
    PlainProfile,
    | "loaded"
    | "profiles"
    | "diagnostics"
    | "resolveProfile"
    | "changed"
    | "duplicate"
    | "ejectDefault"
    | "restoreDefault"
    | "prepareDelete"
    | "delete"
    | "getSource"
    | "defaultDocumentPath"
    | "prepareCreate"
    | "prepareShare"
    | "prepareImport"
    | "materializeDefault"
  >;
  db: Pick<
    PlainZoteroReads,
    | "refresh"
    | "state"
    | "error"
    | "changed"
    | "degraded"
    | "refresh-failed"
    | "refreshing"
    | "db-file-missing"
    | "refresh-requested"
    | "activeReadMode"
  >;
  /** The live Library Scope the Library scope rows read and repair. */
  libraryScope: Pick<
    PlainLibraryScope,
    | "current"
    | "effective"
    | "invalid"
    | "libraries"
    | "changed"
    | "libraries-changed"
  >;
  zoteroPref: Pick<
    PlainZoteroPref,
    | "state"
    | "resolvedProfileDir"
    | "profileDirOverride"
    | "dataDirOverride"
    | "dataDir"
    | "databasePath"
    | "sourceId"
    | "baseAttachmentPath"
    | "httpPort"
    | "get"
    | "changed"
    | "data-dir-changed"
    | "resolved-changed"
    | "setProfileDir"
    | "setDataDir"
    | "companionInstalled"
    | "listProfiles"
  >;
  /** The shared Customize flow the Template document row opens. */
  customize: CustomizeAction;
  /**
   * The template store the Templates, Frontmatter, and Profile rows read.
   * Injected rather than reached through `plugin.services`: the first
   * `getSettingDefinitions()` runs from `addSettingTab()`, while `onload()` is
   * still wiring and that escape hatch still throws.
   */
  template: Pick<
    PlainTemplate,
    | "loaded"
    | "javascriptTemplatesEnabled"
    | "setJavascriptTemplatesEnabled"
    | "getUnrecognizedFiles"
    | "getPartialDocuments"
    | "getReservedPartialFiles"
    | "getPartialDocument"
    | "deletePartial"
    | "getCitationTemplateStatus"
    | "restoreCitationTemplate"
    | "getPartialNames"
    | "createPartial"
    | "materializeCitationTemplate"
    | "compile-status-changed"
  >;
  /** Rebuild the tab's definitions (e.g. after a list mutation or eject). */
  requestUpdate: () => void;
}
