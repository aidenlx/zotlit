import type { App, PluginManifest } from "obsidian";

import type { LanguagePackLifecycle } from "@/lib/i18n";
import type { AttachmentImportService } from "@/services/attachment-import/service";
import type { CitationIndex } from "@/services/citation-index/service";
import type { DatabaseService } from "@/services/database/service";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { PandocEngineService } from "@/services/pandoc/service";
import type { ReleaseService } from "@/services/release/service";
import type { Settings } from "@/services/settings/schema";
import type { SettingsService } from "@/services/settings/service";
import type { TemplateService } from "@/services/template/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

/** Settings keys, used to type declarative `control` bindings against the schema. */
export type SettingsKey = keyof Settings;
export type ProfileControlKey =
  `note-profile:${string}:${"label" | "folder" | "citation-style-inherit" | "citation-style" | "import-folder" | "colored-highlights" | "annotations-as-template"}`;
export type SettingsControlKey = SettingsKey | ProfileControlKey;

/** The release-service surface the setting tab needs — reused by both render paths. */
export type ReleaseTabActions = Pick<
  ReleaseService,
  "openReleaseNote" | "acknowledgeMigration"
>;

/** The Pandoc engine surface the setting tab needs: report, watch, and move its status. */
export type PandocEngineActions = Pick<
  PandocEngineService,
  "getStatus" | "subscribe" | "install" | "uninstall"
>;

/** The Citation Index surface the setting tab needs: the recovery hatch. */
export type CitationIndexActions = Pick<CitationIndex, "reset">;

/** The attachment-import surface the setting tab needs: read and edit the grants. */
export type AttachmentImportActions = Pick<
  AttachmentImportService,
  "approvedFolders" | "approveFolder" | "revokeFolder"
>;

/**
 * Shared dependencies every definition builder receives. Builders read services
 * lazily (inside `render`/predicate callbacks) so `getSettingDefinitions()`
 * itself stays cheap — it runs on every `update()` and once at registration for
 * search indexing.
 */
export interface SettingTabContext {
  app: App;
  /**
   * The plugin's own manifest — its version and its folder in the vault. The
   * plugin object itself stays out of this context: its `services` getter is a
   * debug escape hatch that throws until `onload()` commits, and the first
   * `getSettingDefinitions()` runs inside `onload()`.
   */
  manifest: PluginManifest;
  settings: SettingsService;
  db: DatabaseService;
  /** The live Library Scope the Library scope rows read and repair. */
  libraryScope: LibraryScopeService;
  zoteroPref: ZoteroPrefService;
  /** The approved-folder store the Attachments page lists and mutates. */
  attachmentImport: AttachmentImportActions;
  /** The vault-wide Citation Index, reset from the Maintenance page. */
  citationIndex: CitationIndexActions;
  release: ReleaseTabActions;
  /**
   * The template store the Templates, Frontmatter, and Profile rows read.
   * Injected rather than reached through `plugin.services`: the first
   * `getSettingDefinitions()` runs from `addSettingTab()`, while `onload()` is
   * still wiring and that escape hatch still throws.
   */
  template: TemplateService;
  /** The device-wide Pandoc engine binary, installed and uninstalled from here. */
  pandocEngine: PandocEngineActions;
  languagePack: LanguagePackLifecycle;
  /** Rebuild the tab's definitions (e.g. after a list mutation or eject). */
  requestUpdate: () => void;
}
