import { type App } from "obsidian";

import { type LanguagePackLifecycle } from "@/lib/i18n";
import { type AttachmentImportService } from "@/services/attachment-import/service";
import { type CitationIndex } from "@/services/citation-index/service";
import { type DatabaseService } from "@/services/database/service";
import { type PandocEngineService } from "@/services/pandoc/service";
import { type ReleaseService } from "@/services/release/service";
import { type Settings } from "@/services/settings/schema";
import { type SettingsService } from "@/services/settings/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";
import type ZotLitPlugin from "@/zt-main";

/** Settings keys, used to type declarative `control` bindings against the schema. */
export type SettingsKey = keyof Settings;

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
  plugin: ZotLitPlugin;
  settings: SettingsService;
  db: DatabaseService;
  zoteroPref: ZoteroPrefService;
  /** The approved-folder store the Attachments page lists and mutates. */
  attachmentImport: AttachmentImportActions;
  /** The vault-wide Citation Index, reset from the Diagnostics page. */
  citationIndex: CitationIndexActions;
  release: ReleaseTabActions;
  /** The device-wide Pandoc engine binary, installed and uninstalled from here. */
  pandocEngine: PandocEngineActions;
  languagePack: LanguagePackLifecycle;
  /** Rebuild the tab's definitions (e.g. after a list mutation or eject). */
  requestUpdate: () => void;
}
