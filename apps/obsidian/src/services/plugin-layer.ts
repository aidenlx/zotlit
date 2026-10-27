// The plugin's services that live in the Effect Layer graph, converted or bridged.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Layer } from "effect";
import type { FileSystem } from "effect";
import type { Plugin } from "obsidian";

import type { CliHost } from "@/lib/cli-command";
import { WEB_WORKBENCH_ENABLED } from "@/lib/constants";
import { layerRequestUrlHttpClient } from "@/lib/http-client";
import { layerNotifier } from "@/lib/notifier";
import type { Notifier } from "@/lib/notifier";
import { ObsidianApp } from "@/lib/obsidian-app";
import { layerDeviceStorage } from "@/lib/obsidian-device-storage";
import type { ObsidianEnv } from "@/lib/obsidian-env";
import { layerObsidianEnv } from "@/lib/obsidian-env";
import { layerFileManager } from "@/lib/obsidian-file-manager";
import type { FileManager } from "@/lib/obsidian-file-manager";
import { layerMetadataCache } from "@/lib/obsidian-metadata-cache";
import type { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { layerVault } from "@/lib/obsidian-vault";
import type { Vault } from "@/lib/obsidian-vault";
import type { Workspace } from "@/lib/obsidian-workspace";
import { layerWorkspace } from "@/lib/obsidian-workspace";
import { openSettingsTab } from "@/lib/open-settings";
import { layerPluginHost } from "@/lib/plugin-host";
import { layerViewRegistry } from "@/lib/view-atoms";
import type { ViewRegistry } from "@/lib/view-atoms";
import type { ZoteroHttp } from "@/lib/zotero-http";
import { layerZoteroHttpNode } from "@/lib/zotero-http-node";
import { layerAnnotationNoteActions } from "@/services/note-feature/view-actions";
import type { AnnotationNoteActions } from "@/services/note-feature/view-actions";
import { layerTemplateDataReads } from "@/services/template-workbench/data-reads";
import { layerSettingTab } from "@/setting-tab/layer";
import { openLibraryView } from "@/views/library/register";

import { layerAnnotationLinkReading } from "./annotation-popover/reading";
import { layerAnnotationPopover } from "./annotation-popover/service";
import type { AnnotationPopover } from "./annotation-popover/service";
import { layerCapabilityNotices } from "./annotation-repository/notices";
import type {
  CapabilityNoticePorts,
  CapabilityNotices,
} from "./annotation-repository/notices";
import { layerAnnotationRepository } from "./annotation-repository/service";
import type { AnnotationRepository } from "./annotation-repository/service";
import { layerAttachmentSkipNotice } from "./attachment-import/notices";
import { layerAttachmentImport } from "./attachment-import/service";
import type { AttachmentImport } from "./attachment-import/service";
import { layerAttachmentResolver } from "./attachment-resolver/service";
import type { AttachmentResolver } from "./attachment-resolver/service";
import { layerChineseSegmenter } from "./chinese-segmenter/service";
import type { ChineseSegmenter } from "./chinese-segmenter/service";
import { layerCitationsCli } from "./citation-index/cli/register";
import { layerCitationLookup } from "./citation-index/lookup-service";
import type { CitationLookup } from "./citation-index/lookup-service";
import { layerCitationIndex } from "./citation-index/service";
import type { CitationIndex } from "./citation-index/service";
import { layerCitationParse } from "./citation-parse/service";
import type { CitationParse } from "./citation-parse/service";
import { layerCitationPopover } from "./citation-popover/service";
import type { CitationPopover } from "./citation-popover/service";
import { layerCitationText } from "./citation-text/service";
import type { CitationText } from "./citation-text/service";
import { layerCitekeyCandidatePicker } from "./citekey-editor/candidates";
import { layerCitekeyEditorNotices } from "./citekey-editor/notices";
import { layerCitekeyEditorExtension } from "./citekey-editor/register";
import { layerCitekeyEditor } from "./citekey-editor/service";
import type { CitekeyEditor } from "./citekey-editor/service";
import { layerCitekeyReading } from "./citekey-reading/service";
import { layerDatabaseActions } from "./database/actions";
import { layerExcerptDisplays } from "./excerpt-image/display";
import type { ExcerptDisplays } from "./excerpt-image/display";
import { layerExcerptImages } from "./excerpt-image/layer";
import { layerExcerptPreparation } from "./excerpt-image/prepare";
import type { ExcerptPreparation } from "./excerpt-image/prepare";
import type { ExcerptReaderDocuments } from "./excerpt-image/reader-borrow";
import { layerAnnotationImageCli } from "./excerpt-image/register-cli";
import { layerExcerptRevalidation } from "./excerpt-image/revalidation";
import type { ExcerptImageService } from "./excerpt-image/service";
import type { ExcerptStore } from "./excerpt-image/store";
import { layerGraphCitations } from "./graph-citations/service";
import type { GraphCitations } from "./graph-citations/service";
import { layerItemLookup } from "./item-lookup/service";
import type { ItemLookup } from "./item-lookup/service";
import { layerQueryCli } from "./item-query/cli";
import { layerQueryMeasureCli } from "./item-query/measure";
import { layerQueryService } from "./item-query/service";
import type { QueryService } from "./item-query/service";
import { layerLanguagePackNotices } from "./language-pack/notices";
import { layerLanguagePack } from "./language-pack/service";
import type {
  LanguagePack,
  LanguagePackStartup,
} from "./language-pack/service";
import { layerLibraryScopeCli } from "./library-scope/cli";
import { layerLibraryScopeNotices } from "./library-scope/notices";
import { layerLibraryScope } from "./library-scope/service";
import type { LibraryScope } from "./library-scope/service";
import { layerCustomize } from "./local-bridge/customize";
import type { Customize, CustomizePorts } from "./local-bridge/customize";
import { layerLocalBridge } from "./local-bridge/service";
import type { LocalBridge } from "./local-bridge/service";
import { layerLocalServer } from "./local-server/service";
import type { LocalServer } from "./local-server/service";
import { layerLogging, layerLogOutput } from "./log/service";
import { layerManagedBinaryPlatform } from "./managed-binary/service";
import type { InteractiveCreationPorts } from "./note-feature/creation-view";
import { layerNoteFeatureNotices } from "./note-feature/notices";
import { layerNoteFeature } from "./note-feature/service";
import type { NoteFeature } from "./note-feature/service";
import { layerNoteImporter } from "./note-import/service";
import type { NoteImporter } from "./note-import/service";
import { layerNoteIndex } from "./note-index/service";
import type { NoteIndex } from "./note-index/service";
import { layerCitationStyleNotice } from "./pandoc/notices";
import { layerPandocResolve } from "./pandoc/register";
import { layerBibliographyRender } from "./pandoc/render-cache";
import type { BibliographyRender } from "./pandoc/render-cache";
import { layerPandocEngine } from "./pandoc/service";
import type { PandocEngine } from "./pandoc/service";
import { layerPdfAnnotationEditor } from "./pdf-annotation-editor/service";
import type {
  PdfAnnotationEditor,
  PdfAnnotationEditorPorts,
} from "./pdf-annotation-editor/service";
import { layerProfile } from "./profile/service";
import type { Profile } from "./profile/service";
import { layerProtocolHandlers } from "./protocol/register";
import type { ProtocolDeps } from "./protocol/register";
import { layerQueryClients } from "./query-client/service";
import type { QueryClients } from "./query-client/service";
import { layerReleaseActions } from "./release/actions";
import { layerRelease } from "./release/service";
import type { Release } from "./release/service";
import { layerPluginSettings } from "./settings/service";
import type { PluginSettings } from "./settings/service";
import { startingAs } from "./startup-failure";
import { layerTemplateWorkbenchCli } from "./template-workbench/register";
import { layerCitationTemplateActions } from "./template/actions";
import { layerTemplateMigration } from "./template/migration";
import type {
  TemplateMigration,
  TemplateMigrationOptions,
} from "./template/migration";
import { readMigrationVerificationData } from "./template/migration-data";
import { layerTemplate } from "./template/service";
import type { Template } from "./template/service";
import { layerUseLedger } from "./use-ledger/service";
import type { UseLedger } from "./use-ledger/service";
import { layerWikilinkEditor } from "./wikilink-editor/service";
import { layerWikilinkReading } from "./wikilink-reading/service";
import { layerZoteroLocalApi } from "./zotero-local-api/service";
import type { ZoteroLocalApi } from "./zotero-local-api/service";
import { SecretWriteAuthorizationStore } from "./zotero-local-api/write-authorization";
import { layerZoteroPref, layerZoteroPrefFiles } from "./zotero-pref/service";
import type { ZoteroPref } from "./zotero-pref/service";
import { layerZoteroReads } from "./zotero-reads/service";
import type { ZoteroReads } from "./zotero-reads/service";
import { workerClient } from "./zotero-reads/worker-client";

/**
 * The graph `createPluginRuntime` builds over `plugin`: every plugin
 * service. Settings and logging build first, so every other service
 * logs from its first line and closes before them. Every service reads time
 * from the Effect Clock, which a test replaces. Each layer starts under its
 * service's name, so a defect during acquisition names what failed.
 *
 * The Language Pack starts from what `startLanguagePack` applied before the
 * graph, so every service's copy already reads in the user's language.
 *
 * Above the services sit the layers that register a service's notices and
 * commands on `plugin`. They hold no service of their own, so unloading the
 * plugin releases them before the services they read.
 */
export function pluginLayer(
  plugin: Plugin & CliHost,
  migration: Pick<TemplateMigrationOptions, "openPrompt">,
  {
    capabilityNotices,
    creation,
    customize,
    excerpt,
    languagePack,
    protocol,
    pdfEditor,
  }: {
    readonly capabilityNotices: CapabilityNoticePorts;
    readonly pdfEditor: PdfAnnotationEditorPorts;
    readonly creation: InteractiveCreationPorts;
    /** The launch sheet, the browser and the native editor Customize opens. */
    readonly customize: CustomizePorts;
    /** The note import's modals and the Attachment opener the protocol handlers call. */
    readonly protocol: Pick<ProtocolDeps, "noteImportView" | "opener">;
    readonly excerpt: {
      readonly openStore: () => Promise<ExcerptStore>;
      readonly readers: ExcerptReaderDocuments;
    };
    readonly languagePack: LanguagePackStartup;
  },
): Layer.Layer<
  | GraphCitations
  | PdfAnnotationEditor
  | LanguagePack
  | LocalBridge
  | Notifier
  | AnnotationRepository
  | AnnotationNoteActions
  | CapabilityNotices
  | AnnotationPopover
  | CitekeyEditor
  | Customize
  | ItemLookup
  | QueryService
  | ExcerptDisplays
  | ExcerptImageService
  | ExcerptPreparation
  | CitationText
  | CitationPopover
  | CitationIndex
  | BibliographyRender
  | CitationLookup
  | Profile
  | LibraryScope
  | AttachmentImport
  | AttachmentResolver
  | ZoteroReads
  | PluginSettings
  | Release
  | UseLedger
  | QueryClients
  | CitationParse
  | ZoteroPref
  | ChineseSegmenter
  | PandocEngine
  | NoteIndex
  | NoteFeature
  | NoteImporter
  | LocalServer
  | ZoteroLocalApi
  | ZoteroHttp
  | Template
  | TemplateMigration
  | ViewRegistry
  | Vault
  | FileManager
  | Workspace
  | MetadataCache
  | ObsidianEnv
  | FileSystem.FileSystem
> {
  // The file manager decides its outcomes from the vault's cache.
  const fileManager = layerFileManager.pipe(Layer.provide(layerVault));
  // What both halves read from Obsidian: the App, its environment, notices.
  const obsidian = Layer.mergeAll(
    layerNotifier,
    layerObsidianEnv,
    layerDeviceStorage,
    layerMetadataCache,
    fileManager,
    layerWorkspace,
    layerVault,
  ).pipe(Layer.provideMerge(Layer.succeed(ObsidianApp, plugin.app)));
  const services = Layer.mergeAll(
    layerCitationPopover.pipe(startingAs("CitationPopover")),
    layerAnnotationPopover.pipe(startingAs("AnnotationPopover")),
    layerCapabilityNotices(capabilityNotices).pipe(
      startingAs("CapabilityNotices"),
    ),
    layerItemLookup.pipe(startingAs("ItemLookup")),
    layerNoteImporter.pipe(startingAs("NoteImporter")),
    layerLocalBridge({
      webWorkbenchEnabled: WEB_WORKBENCH_ENABLED,
      pluginVersion: plugin.manifest.version,
    }).pipe(startingAs("LocalBridge")),
    layerQueryService({ pluginVersion: plugin.manifest.version }).pipe(
      startingAs("QueryService"),
    ),
  ).pipe(
    Layer.provideMerge(layerCitationText().pipe(startingAs("CitationText"))),
    Layer.provideMerge(layerCitationIndex().pipe(startingAs("CitationIndex"))),
    Layer.provideMerge(
      Layer.mergeAll(
        layerBibliographyRender.pipe(startingAs("BibliographyRender")),
        layerCitationLookup.pipe(startingAs("CitationLookup")),
      ),
    ),
    // The migration verifies a conversion against a real in-scope item.
    Layer.provideMerge(
      layerTemplateMigration({
        ...migration,
        loadVerificationData: readMigrationVerificationData,
      }).pipe(startingAs("TemplateMigration")),
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        layerLibraryScope.pipe(startingAs("LibraryScope")),
        layerProfile.pipe(startingAs("Profile")),
        layerAttachmentResolver().pipe(startingAs("AttachmentResolver")),
        layerAttachmentImport().pipe(startingAs("AttachmentImport")),
      ),
    ),
    Layer.provideMerge(
      layerAnnotationRepository({}).pipe(startingAs("AnnotationRepository")),
    ),
    Layer.provideMerge(
      layerExcerptDisplays.pipe(startingAs("ExcerptDisplays")),
    ),
    Layer.provideMerge(
      layerExcerptPreparation.pipe(startingAs("ExcerptPreparation")),
    ),
    Layer.provideMerge(
      layerExcerptImages(excerpt).pipe(startingAs("ExcerptImages")),
    ),
    Layer.provideMerge(
      layerZoteroReads(workerClient()).pipe(startingAs("ZoteroReads")),
    ),
    Layer.provideMerge(
      // The Remembered Write Authorization lives in Obsidian's Keychain,
      // where the user can see and delete it — never in synced settings.
      layerZoteroLocalApi({
        credentials: new SecretWriteAuthorizationStore({
          secrets: plugin.app.secretStorage,
        }),
      }).pipe(startingAs("ZoteroLocalApi")),
    ),
    Layer.provideMerge(layerLocalServer.pipe(startingAs("LocalServer"))),
    Layer.provideMerge(
      Layer.mergeAll(
        layerUseLedger.pipe(startingAs("UseLedger")),
        layerRelease({
          version: plugin.manifest.version,
          // A first install or an update opens the Library View, in place of
          // the empty tab or beside the open note.
          openFirstScreen: async () => {
            await openLibraryView(plugin.app, { pane: "first-screen" });
          },
        }).pipe(startingAs("Release")),
        layerTemplate.pipe(startingAs("Template")),
        layerZoteroPref.pipe(
          Layer.provide(layerZoteroPrefFiles),
          startingAs("ZoteroPref"),
        ),
        Layer.mergeAll(
          layerChineseSegmenter.pipe(startingAs("ChineseSegmenter")),
          layerPandocEngine.pipe(startingAs("PandocEngine")),
        ).pipe(Layer.provide(layerManagedBinaryPlatform)),
        layerNoteIndex.pipe(startingAs("NoteIndex")),
        layerCitationParse.pipe(startingAs("CitationParse")),
        layerQueryClients.pipe(startingAs("QueryClients")),
        layerZoteroHttpNode.pipe(startingAs("ZoteroHttp")),
      ),
    ),
    // The note writers (`note-feature/`) create and move notes through these tags.
    // The protocol handlers also open notes through the
    // Workspace and read the vault folder from the environment. The Customize
    // flow reads the active note's paper from the metadata cache.
    Layer.provideMerge(
      Layer.mergeAll(
        layerVault,
        fileManager,
        layerWorkspace,
        layerObsidianEnv,
        layerMetadataCache,
      ),
    ),
    Layer.provideMerge(
      layerLanguagePack(languagePack).pipe(
        Layer.provide(layerRequestUrlHttpClient),
        startingAs("LanguagePack"),
      ),
    ),
    Layer.provide(obsidian),
    Layer.provideMerge(
      layerLogging.pipe(
        Layer.provide(layerLogOutput(plugin)),
        startingAs("Logging"),
      ),
    ),
    Layer.provideMerge(
      layerPluginSettings(plugin).pipe(startingAs("PluginSettings")),
    ),
  );
  const registrations = Layer.mergeAll(
    layerAnnotationImageCli.pipe(startingAs("AnnotationImageCli")),
    layerAttachmentSkipNotice({
      openSettings: () => {
        openSettingsTab(plugin.app, plugin.manifest.id, [
          "settings_page_attachments",
          "settings_attachment_approved",
        ]);
      },
    }).pipe(startingAs("AttachmentSkipNotice")),
    layerAnnotationLinkReading.pipe(startingAs("AnnotationLinkReading")),
    layerCitationsCli.pipe(startingAs("CitationsCli")),
    layerCitationStyleNotice.pipe(startingAs("CitationStyleNotice")),
    layerCitationTemplateActions.pipe(startingAs("CitationTemplateActions")),
    layerCitekeyCandidatePicker.pipe(startingAs("CitekeyCandidatePicker")),
    layerCitekeyEditorExtension.pipe(startingAs("CitekeyEditorExtension")),
    layerCitekeyEditorNotices.pipe(startingAs("CitekeyEditorNotices")),
    layerCitekeyReading.pipe(startingAs("CitekeyReading")),
    layerDatabaseActions.pipe(startingAs("DatabaseActions")),
    layerExcerptRevalidation.pipe(startingAs("ExcerptRevalidation")),
    layerGraphCitations.pipe(startingAs("GraphCitations")),
    layerLanguagePackNotices.pipe(startingAs("LanguagePackNotices")),
    layerLibraryScopeCli.pipe(startingAs("LibraryScopeCli")),
    layerLibraryScopeNotices.pipe(startingAs("LibraryScopeNotices")),
    layerNoteFeatureNotices.pipe(startingAs("NoteFeatureNotices")),
    layerPandocResolve.pipe(startingAs("PandocResolve")),
    layerProtocolHandlers({
      ...creation,
      ...protocol,
      webWorkbenchEnabled: WEB_WORKBENCH_ENABLED,
    }).pipe(startingAs("ProtocolHandlers")),
    layerQueryCli.pipe(startingAs("QueryCli")),
    // Measurement-only: lets packages/e2e/src/query-measure.ts read the
    // slices, statements, heap, and cancel times of a run. A dev-build port,
    // never registered in a production build.
    __DEV__
      ? layerQueryMeasureCli.pipe(startingAs("QueryMeasureCli"))
      : Layer.empty,
    layerReleaseActions.pipe(startingAs("ReleaseActions")),
    layerSettingTab({ webWorkbenchEnabled: WEB_WORKBENCH_ENABLED }).pipe(
      startingAs("SettingTab"),
    ),
    layerTemplateWorkbenchCli.pipe(startingAs("TemplateWorkbenchCli")),
    layerViewRegistry.pipe(
      Layer.provideMerge(
        Layer.mergeAll(layerTemplateDataReads, layerAnnotationNoteActions),
      ),
      startingAs("ViewRegistry"),
    ),
    layerWikilinkEditor.pipe(startingAs("WikilinkEditor")),
    layerWikilinkReading.pipe(startingAs("WikilinkReading")),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(layerPluginHost(plugin), obsidian, layerNotifier),
    ),
  );
  // The Note Feature plans creations through ZotLit Query, so it builds above
  // the other services. The citekey editor creates notes through it.
  // Customize launches over the Local Bridge.
  const noteFeature = Layer.mergeAll(
    layerCitekeyEditor(creation).pipe(startingAs("CitekeyEditor")),
    layerCustomize(customize).pipe(startingAs("Customize")),
  ).pipe(
    Layer.provide(layerNotifier),
    Layer.provideMerge(
      layerNoteFeature.pipe(
        startingAs("NoteFeature"),
        Layer.provideMerge(services),
      ),
    ),
  );
  // The Node file system, once for the whole graph: the temp sweeps read it,
  // and so do the Profile dialogs that callers outside the graph open.
  // The Notifier is the one the layers share: the setting tab's Language Pack
  // toast shows through it.
  return registrations.pipe(
    Layer.provideMerge(
      layerPdfAnnotationEditor(pdfEditor).pipe(
        startingAs("PdfAnnotationEditor"),
        Layer.provideMerge(noteFeature),
      ),
    ),
    Layer.provideMerge(NodeFileSystem.layer),
    Layer.merge(layerNotifier),
  );
}
