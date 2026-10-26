import type { App, PluginManifest } from "obsidian";

import type { LanguagePackLifecycle } from "@/lib/i18n";
import type { AttachmentImportHandle } from "@/services/attachment-import/handle";
import type { PlainCitationIndex } from "@/services/citation-index/plain";
import type {} from "@/services/citation-index/service";
import type { ExcerptDisplayService } from "@/services/excerpt-image/display";
import type { ExcerptImageService } from "@/services/excerpt-image/service";
import type { CustomizeAction } from "@/services/local-bridge/customize";
import type { LocalBridgeHandle } from "@/services/local-bridge/handle";
import type { LocalServer } from "@/services/local-server/service";
import type { ManagedBinaryHandle } from "@/services/managed-binary/handle";
import type { PlainProfile } from "@/services/profile/plain";
import type { Release } from "@/services/release/service";
import type { Settings } from "@/services/settings/schema";
import type { PluginSettings } from "@/services/settings/service";
import type { PlainTemplate } from "@/services/template/plain";

import type { SettingTabShape } from "./effect-tab";
import type { ImportProfile } from "./import-profile-modal";

/** Settings keys, used to type declarative `control` bindings against the schema. */
export type SettingsKey = keyof Settings;
export type ProfileControlKey =
  `note-profile:default:${"folder" | "citation-style" | "import-folder" | "colored-highlights" | "annotations-as-template"}`;
export type SettingsControlKey = SettingsKey | ProfileControlKey;

/** The release-service surface the setting tab needs — reused by both render paths. */
export type ReleaseTabActions = Pick<
  Release["Service"],
  "openReleaseNote" | "acknowledgeMigration"
>;

/** The Managed Binary surface the setting tab needs: report, watch, and move its status. */
export type ManagedBinaryActions = Pick<
  ManagedBinaryHandle,
  "binary" | "runSync" | "runPromise"
>;

/** The Local Server surface the setting tab needs: the bound port and its edges. */
export type LocalServerActions = Pick<
  LocalServer["Service"],
  "effectivePort" | "effectivePortChanges"
>;

/** The Local Bridge surface the setting tab needs: the live connection and its end. */
export type LocalBridgeActions = Pick<
  LocalBridgeHandle,
  "connection" | "disconnect" | "on"
>;

/** The Citation Index surface the setting tab needs: the recovery hatch. */
export type CitationIndexActions = Pick<PlainCitationIndex, "reset">;

/** The attachment-import surface the setting tab needs: read and edit the grants. */
export type AttachmentImportActions = Pick<
  AttachmentImportHandle,
  "approvedFolders" | "approveFolder" | "revokeFolder"
>;

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
  /** The one loopback listener, read by the Local server rows. */
  localServer: LocalServerActions;
  /** The Workbench Connection the Local server rows name and end. */
  localBridge: LocalBridgeActions;
  /** The shared Customize flow the Template document row opens. */
  customize: CustomizeAction;
  /** The approved-folder store the Attachments page lists and mutates. */
  attachmentImport: AttachmentImportActions;
  /** The vault-wide Citation Index, reset from the Maintenance page. */
  citationIndex: CitationIndexActions;
  /** The derived image store, cleared from the Maintenance page. */
  excerptImage: Pick<ExcerptImageService, "clear">;
  /** The live Excerpt Image display, released with the store it paints from. */
  excerptDisplay: Pick<ExcerptDisplayService, "clear">;
  release: ReleaseTabActions;
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
  /** The device-wide Pandoc engine binary, installed and uninstalled from here. */
  pandocEngine: ManagedBinaryActions;
  /** The device-wide Chinese Segmenter binary, installed and uninstalled from here. */
  chineseSegmenter: ManagedBinaryActions;
  languagePack: LanguagePackLifecycle;
  /** Rebuild the tab's definitions (e.g. after a list mutation or eject). */
  requestUpdate: () => void;
}
