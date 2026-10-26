// The plugin's services that live in the Effect Layer graph, converted or bridged.
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Layer } from "effect";
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
import { layerPluginHost } from "@/lib/plugin-host";
import type { ZoteroHttp } from "@/lib/zotero-http";
import { layerZoteroHttpNode } from "@/lib/zotero-http-node";
import { openLibraryView } from "@/views/library/register";

import { layerAnnotationLinkReading } from "./annotation-popover/reading";
import { layerAnnotationPopover } from "./annotation-popover/service";
import type { AnnotationPopover } from "./annotation-popover/service";
import { layerAnnotationRepository } from "./annotation-repository/service";
import type { AnnotationRepository } from "./annotation-repository/service";
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
import type {
  CitekeyEditor,
  CitekeyNoteCreation,
} from "./citekey-editor/service";
import { layerCitekeyReading } from "./citekey-reading/service";
import { layerDatabaseActions } from "./database/actions";
import { layerExcerptDisplays } from "./excerpt-image/display";
import type { ExcerptDisplays } from "./excerpt-image/display";
import { layerExcerptImages } from "./excerpt-image/layer";
import type { ExcerptImages } from "./excerpt-image/layer";
import type { ExcerptReaderDocuments } from "./excerpt-image/reader-borrow";
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
import { layerLocalBridge } from "./local-bridge/service";
import type { LocalBridge } from "./local-bridge/service";
import { layerLocalServer } from "./local-server/service";
import type { LocalServer } from "./local-server/service";
import { layerLogging, layerLogOutput } from "./log/service";
import { layerManagedBinaryPlatform } from "./managed-binary/service";
import { layerNoteImporter } from "./note-import/service";
import type { NoteImporter, NoteImportPorts } from "./note-import/service";
import { layerNoteIndex } from "./note-index/service";
import type { NoteIndex } from "./note-index/service";
import { layerCitationStyleNotice } from "./pandoc/notices";
import { layerPandocResolve } from "./pandoc/register";
import { layerBibliographyRender } from "./pandoc/render-cache";
import type { BibliographyRender } from "./pandoc/render-cache";
import { layerPandocEngine } from "./pandoc/service";
import type { PandocEngine } from "./pandoc/service";
import { layerProfile } from "./profile/service";
import type { Profile } from "./profile/service";
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
 * The graph `buildServices` builds before the container over `plugin`:
 * converted services, and the legacy services bridged into it with
 * `serviceLayer`. Settings and logging build first, so every other service
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
    excerpt,
    languagePack,
    noteCreation,
    noteImport,
  }: {
    readonly excerpt: {
      readonly openStore: () => Promise<ExcerptStore>;
      readonly readers: ExcerptReaderDocuments;
    };
    readonly languagePack: LanguagePackStartup;
    readonly noteCreation: CitekeyNoteCreation;
    readonly noteImport: NoteImportPorts;
  },
): Layer.Layer<
  | GraphCitations
  | LanguagePack
  | LocalBridge
  | Notifier
  | AnnotationRepository
  | AnnotationPopover
  | CitekeyEditor
  | ItemLookup
  | QueryService
  | ExcerptDisplays
  | ExcerptImages
  | CitationText
  | CitationPopover
  | CitationIndex
  | BibliographyRender
  | CitationLookup
  | Profile
  | LibraryScope
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
  | NoteImporter
  | LocalServer
  | ZoteroLocalApi
  | ZoteroHttp
  | Template
  | TemplateMigration
  | Vault
  | FileManager
  | Workspace
  | MetadataCache
  | ObsidianEnv
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
    layerCitekeyEditor(noteCreation).pipe(startingAs("CitekeyEditor")),
    layerItemLookup.pipe(startingAs("ItemLookup")),
    layerNoteImporter(noteImport).pipe(startingAs("NoteImporter")),
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
      ),
    ),
    Layer.provideMerge(
      layerAnnotationRepository({}).pipe(startingAs("AnnotationRepository")),
    ),
    Layer.provideMerge(
      layerExcerptDisplays.pipe(startingAs("ExcerptDisplays")),
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
    // The legacy note writers create and move through the tags (`build.ts`).
    // The protocol handlers (`zt-main.ts`) also open notes through the
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
    layerAnnotationLinkReading.pipe(startingAs("AnnotationLinkReading")),
    layerCitationsCli.pipe(startingAs("CitationsCli")),
    layerCitationStyleNotice.pipe(startingAs("CitationStyleNotice")),
    layerCitationTemplateActions.pipe(startingAs("CitationTemplateActions")),
    layerCitekeyCandidatePicker.pipe(startingAs("CitekeyCandidatePicker")),
    layerCitekeyEditorExtension.pipe(startingAs("CitekeyEditorExtension")),
    layerCitekeyEditorNotices.pipe(startingAs("CitekeyEditorNotices")),
    layerCitekeyReading.pipe(startingAs("CitekeyReading")),
    layerDatabaseActions.pipe(startingAs("DatabaseActions")),
    layerGraphCitations.pipe(startingAs("GraphCitations")),
    layerLanguagePackNotices.pipe(startingAs("LanguagePackNotices")),
    layerLibraryScopeCli.pipe(startingAs("LibraryScopeCli")),
    layerLibraryScopeNotices.pipe(startingAs("LibraryScopeNotices")),
    layerPandocResolve.pipe(startingAs("PandocResolve")),
    layerQueryCli.pipe(startingAs("QueryCli")),
    // Measurement-only: lets packages/e2e/src/query-measure.ts read the
    // slices, statements, heap, and cancel times of a run. A dev-build port,
    // never registered in a production build.
    __DEV__
      ? layerQueryMeasureCli.pipe(startingAs("QueryMeasureCli"))
      : Layer.empty,
    layerReleaseActions.pipe(startingAs("ReleaseActions")),
    layerTemplateWorkbenchCli.pipe(startingAs("TemplateWorkbenchCli")),
    layerWikilinkEditor.pipe(startingAs("WikilinkEditor")),
    layerWikilinkReading.pipe(startingAs("WikilinkReading")),
  ).pipe(Layer.provide(Layer.mergeAll(layerPluginHost(plugin), obsidian)));
  // The Node file system, once for the whole graph: the temp sweeps read it.
  // The Notifier is the one the layers share: the setting tab's Language Pack
  // toast shows through it.
  return registrations.pipe(
    Layer.provideMerge(services),
    Layer.provide(NodeFileSystem.layer),
    Layer.merge(layerNotifier),
  );
}
