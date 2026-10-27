import { Effect, FileSystem } from "effect";
import type { FileSystemAdapter } from "obsidian";

import { passAborted } from "@/lib/abort-error";
import { cliRunner } from "@/lib/cli-command";
import { WEB_WORKBENCH_ENABLED } from "@/lib/constants";
import { DisposableAbortController } from "@/lib/disposables";
import { effectBridge, exitOver, valueOr } from "@/lib/effect-bridge";
import { fromInstant } from "@/lib/effect-clock";
import { buildRuntime } from "@/lib/effect-layer";
import { Notifier } from "@/lib/notifier";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Workspace } from "@/lib/obsidian-workspace";
import { revealSetting } from "@/lib/open-settings";
import { ZoteroHttp } from "@/lib/zotero-http";
import { libraryTagNamesOf } from "@/services/database/library-tag-names";
import type { ImportProfile } from "@/setting-tab/import-profile-modal";
import {
  createProfileDialog,
  importProfileDialog,
} from "@/setting-tab/profile-dialogs";
import type { ProfileDialogServices } from "@/setting-tab/profile-dialogs";
import { blockedNotice } from "@/views/annot-view/card-verbs";
import {
  annotationCardShown,
  revealAnnotationInView,
} from "@/views/annot-view/register";
import {
  profileCustomization,
  saveProfileCustomization,
} from "@/views/template-workbench/preferences";
import { openNativeProfile } from "@/views/template-workbench/register";
import { openWelcomeView } from "@/views/welcome/register";
import type ZotLitPlugin from "@/zt-main";

import { AnnotationPopover } from "./annotation-popover/service";
import { CapabilityNotices } from "./annotation-repository/notices";
import { bindCapabilityNotices } from "./annotation-repository/notices-handle";
import { AnnotationRepository } from "./annotation-repository/service";
import { createPdfReader } from "./attachment-open/actions";
import { openWithSystem } from "./attachment-open/capture";
import { bindLiteratureNoteAttachments } from "./attachment-open/handle";
import type { LiteratureNoteServices } from "./attachment-open/literature-note";
import { createTargetOpener } from "./attachment-open/open-target";
import { AttachmentResolver } from "./attachment-resolver/service";
import { ChineseSegmenter } from "./chinese-segmenter/service";
import {
  plainCitationIndex,
  plainCitationLookup,
} from "./citation-index/plain";
import { plainCitationParse } from "./citation-parse/plain";
import { CitationParse } from "./citation-parse/service";
import { CitationPopover } from "./citation-popover/service";
import { plainCitationText } from "./citation-text/plain";
import { CitekeyEditor } from "./citekey-editor/service";
import { ExcerptDisplays } from "./excerpt-image/display";
import type { ExcerptReaderDocuments } from "./excerpt-image/reader-borrow";
import { ExcerptImageService } from "./excerpt-image/service";
import { openExcerptStore } from "./excerpt-image/store";
import { GraphCitations } from "./graph-citations/service";
import { bindItemLookup } from "./item-lookup/handle";
import { ItemLookup } from "./item-lookup/service";
import { bindQuery } from "./item-query/handle";
import { QueryService } from "./item-query/service";
import type { LanguagePackStartup } from "./language-pack/service";
import { plainLibraryScope } from "./library-scope/plain";
import { bindCustomize, Customize } from "./local-bridge/customize";
import { bindLocalBridge } from "./local-bridge/handle";
import { createLaunchSheet } from "./local-bridge/launch-sheet";
import { LocalBridge } from "./local-bridge/service";
import { LocalServer } from "./local-server/service";
import { bindManagedBinary } from "./managed-binary/handle";
import { bindNoteFeature, NoteFeature } from "./note-feature";
import type { NoteFeatureHandle } from "./note-feature";
import { bindNoteActions } from "./note-feature/actions-handle";
import type { NoteActionServices } from "./note-feature/actions-view";
import { bindNoteCitations } from "./note-feature/citations-handle";
import type { NoteCitationServices } from "./note-feature/citations-handle";
import { bindNoteCreation } from "./note-feature/creation-handle";
import type { NoteCreationServices } from "./note-feature/creation-handle";
import type { InteractiveCreationPorts } from "./note-feature/creation-view";
import { batchUpdateNotices } from "./note-feature/update-single";
import type { BatchImportServices } from "./note-import/batch-import";
import { bindBatchImport } from "./note-import/batch-import-handle";
import { createNoteImportView } from "./note-import/view";
import { plainNoteIndex } from "./note-index/plain";
import { plainBibliographyRender } from "./pandoc/render-cache/plain";
import { PandocEngine } from "./pandoc/service";
import { PdfAnnotationEditor } from "./pdf-annotation-editor/service";
import { pluginLayer } from "./plugin-layer";
import { plainProfile } from "./profile/plain";
import { Profile } from "./profile/service";
import type { ProtocolDeps } from "./protocol/register";
import { plainQueryClients } from "./query-client/plain";
import { Release } from "./release/service";
import { ServiceContainer } from "./service-base";
import { PluginSettings } from "./settings/service";
import type { TemplateDataServices } from "./template-workbench/data";
import { bindTemplateData } from "./template-workbench/data-handle";
import type { TemplateMigrationOptions } from "./template/migration";
import { plainTemplate, plainTemplateMigration } from "./template/plain";
import { plainUseLedger } from "./use-ledger/plain";
import { writeReadUse } from "./zotero-local-api/last-read";
import { ZoteroLocalApi } from "./zotero-local-api/service";
import { plainZoteroPref } from "./zotero-pref/plain";
import { ZoteroPref } from "./zotero-pref/service";
import { plainZoteroReads } from "./zotero-reads/plain";
import { ZoteroReads } from "./zotero-reads/service";

/** What the protocol handlers open: the note import's modals and the Attachment opener. */
type ProtocolViews = Pick<ProtocolDeps, "noteImportView" | "opener">;

/**
 * Construct and wire all Obsidian plugin services.
 *
 * This function does not own lifecycle. `zt-main.ts` creates the stack, passes
 * it here, and moves the stack only after all plugin startup wiring succeeds.
 *
 * The runtime over {@link pluginLayer} finishes acquisition first, including
 * each layer's asynchronous first load. The container then
 * injects its services with `useValue`: a graph service as the tag's service
 * (`() => runtime.runSync(Tag)`), which legacy consumers run through the
 * container's `bridge`, a bridged one as it is. The runtime's disposal sits under every
 * container registration on `stack`, so the whole graph closes after the last
 * container service has disposed: a container service never outlives a layer
 * it uses. A service leaves the container for the graph as it converts or is
 * bridged.
 *
 * Within the container, registration order matters: services dispose in LIFO.
 */
export async function buildServices(
  plugin: ZotLitPlugin,
  stack: AsyncDisposableStack,
  languagePack: LanguagePackStartup,
) {
  let bindMigration!: (
    actions: Pick<TemplateMigrationOptions, "openPrompt">,
  ) => void;
  const migrationActions = new Promise<
    Pick<TemplateMigrationOptions, "openPrompt">
  >((resolve) => {
    bindMigration = resolve;
  });
  // The note creation opens the setting tab's Profile dialogs, which run in
  // the caller's fiber with the caller's services.
  const creation: InteractiveCreationPorts = {
    app: plugin.app,
    createProfile: (options) => createProfileDialog(plugin.app, options),
    importProfile: (options) => importProfileDialog(plugin.app, options),
  };
  // The protocol handlers open the note import's modals and the Attachment
  // opener, which the container builds after the graph.
  let bindProtocolViews!: (views: ProtocolViews) => void;
  const protocolViews = new Promise<ProtocolViews>((resolve) => {
    bindProtocolViews = resolve;
  });
  const importView = Effect.promise(async () => {
    const { noteImportView } = await protocolViews;
    return noteImportView;
  });
  const protocol: ProtocolViews = {
    noteImportView: {
      openBatchModal: (options) => {
        void protocolViews.then(({ noteImportView }) =>
          noteImportView.openBatchModal(options),
        );
      },
      confirm: (options) =>
        Effect.flatMap(importView, (view) => view.confirm(options)),
      chooseProfile: (options) =>
        Effect.flatMap(importView, (view) => view.chooseProfile(options)),
    },
    opener: {
      open: async (target, pane) =>
        (await protocolViews).opener.open(target, pane),
    },
  };
  // The excerpt service is registered before the PDF reader, so the reader
  // hands its documents over through this one holder. A crop asks for a reader
  // document per resolution, and answers detached while the holder is empty.
  let reader: PdfAnnotationEditor | undefined;
  const readers: ExcerptReaderDocuments = {
    borrow: (path) => reader?.borrowDocument(path) ?? null,
  };
  const runtime = buildRuntime(
    pluginLayer(
      plugin,
      {
        openPrompt: async () => (await migrationActions).openPrompt(),
      },
      {
        capabilityNotices: {
          openEditingSettings: () =>
            revealSetting(
              plugin.app,
              plugin.manifest.id,
              "settings_zotero_editing",
            ),
          cardShown: (annotationKey) =>
            annotationCardShown(plugin.app, annotationKey),
          revealAnnotation: (annotationKey) =>
            void revealAnnotationInView(plugin, annotationKey),
        },
        creation,
        customize: {
          webWorkbenchEnabled: WEB_WORKBENCH_ENABLED,
          pluginVersion: plugin.manifest.version,
          confirmLaunch: createLaunchSheet(plugin.app),
          openExternal: (url) => window.open(url),
          preference: () => profileCustomization(plugin.app),
          rememberPreference: (value) =>
            saveProfileCustomization(plugin.app, value),
          openNative: ({ item, originatingNote }, target) =>
            openNativeProfile(plugin.app, target, {
              ...(item ? { itemIndexedKey: item.key } : {}),
              originatingNote,
              explainUnsupported: false,
              customize: true,
            }),
        },
        protocol,
        excerpt: {
          openStore: () => openExcerptStore(plugin.app.appId),
          readers,
        },
        languagePack,
      },
    ),
    stack,
  );
  await runtime.context();
  const bridge = effectBridge(runtime);
  const zoteroReadsService = runtime.runSync(ZoteroReads);
  const zoteroLocalApiService = runtime.runSync(ZoteroLocalApi);
  const container = new ServiceContainer(stack, (key, error) => {
    console.error(`Service "${key}" failed to initialize`, error);
  });

  return container
    .useValue({ runtime: () => runtime })
    .useValue({ bridge: () => bridge })
    .useValue({ workspace: () => runtime.runSync(Workspace) })
    .useValue({ metadataCache: () => runtime.runSync(MetadataCache) })
    .useValue({ notifier: () => runtime.runSync(Notifier) })
    .useValue({ zoteroPrefService: () => runtime.runSync(ZoteroPref) })
    .useValue({ fileSystem: () => runtime.runSync(FileSystem.FileSystem) })
    .useValue({
      settings: () => runtime.runSync(PluginSettings),
    })
    .useValue({
      useLedger: () => plainUseLedger(runtime),
    })
    .useValue({
      // Above every container service on the stack, so unload interrupts a
      // command still running before the services it reads dispose.
      runCli: () =>
        cliRunner(runtime, stack.use(new DisposableAbortController()).signal),
    })
    .useValue({
      queryClient: () => plainQueryClients(runtime),
    })
    .useValue({ release: () => runtime.runSync(Release) })
    .useValue({
      template: () => plainTemplate(runtime),
    })
    .useValue({
      noteIndex: () => plainNoteIndex(runtime),
    })
    .useValue({
      zoteroPref: () => plainZoteroPref(runtime),
    })
    .useValue({ localServer: () => runtime.runSync(LocalServer) })
    .useValue({ zoteroHttp: () => runtime.runSync(ZoteroHttp) })
    .useValue({
      chineseSegmenter: () =>
        bindManagedBinary(bridge, runtime.runSync(ChineseSegmenter)),
    })
    .useValue({
      zoteroReads: () => plainZoteroReads(runtime),
    })
    .useValue({
      libraryTagNames: () => libraryTagNamesOf(runtime),
    })
    .useValue({ excerptImage: () => runtime.runSync(ExcerptImageService) })
    .useValue({ excerptDisplay: () => runtime.runSync(ExcerptDisplays) })
    .useValue({
      attachmentResolver: () => runtime.runSync(AttachmentResolver),
    })
    .useValue({
      // Every ZotLit gesture that opens an Attachment, and File Link Capture
      // for a link Obsidian rendered, decides through this one opener.
      targetOpener: ({ attachmentResolver, settings }) =>
        createTargetOpener({
          attachments: attachmentResolver,
          reader: createPdfReader({ app: plugin.app, settings, bridge }),
          native: openWithSystem,
          settings,
          bridge,
          // Desktop-only plugin: the adapter is always a `FileSystemAdapter`.
          vaultBasePath: (
            plugin.app.vault.adapter as FileSystemAdapter
          ).getBasePath(),
        }),
    })
    .useValue({
      literatureNoteAttachments: () =>
        bindLiteratureNoteAttachments(
          bridge,
          runtime.runSync(Effect.context<LiteratureNoteServices>()),
        ),
    })
    .useValue({ zoteroLocalApi: () => zoteroLocalApiService })
    .useValue({
      annotationRepository: () => runtime.runSync(AnnotationRepository),
    })
    .useValue({
      capabilityNotices: () =>
        bindCapabilityNotices(bridge, runtime.runSync(CapabilityNotices)),
    })
    .use({
      pdfAnnotationEditor: ({
        useLedger,
        zoteroLocalApi,
        attachmentResolver,
        annotationRepository,
        capabilityNotices,
        libraryTagNames,
        noteIndex,
        settings,
      }) => {
        reader = new PdfAnnotationEditor({
          recordRead: ({ attachmentKey, itemKey, serverID, instant }) => {
            useLedger.record(itemKey, "read", instant);
            void bridge.runPromiseExit(
              writeReadUse({
                attachmentKey,
                instant: fromInstant(instant),
                serverID,
              }).pipe(
                Effect.provideService(ZoteroReads, zoteroReadsService),
                Effect.provideService(ZoteroLocalApi, zoteroLocalApi),
              ),
            );
          },
          app: plugin.app,
          attachments: attachmentResolver,
          annotations: annotationRepository,
          bridge,
          noteIndex,
          libraryTagNames,
          settings,
          capabilityGestures: {
            reportBlockedGesture: (attachmentKey) =>
              capabilityNotices.reportBlockedGesture(attachmentKey),
            allowEditing: () =>
              void capabilityNotices.showEditingCapability().catch(passAborted),
          },
          markGestures: {
            revealAnnotation: (annotationKey) =>
              void revealAnnotationInView(plugin, annotationKey),
            // The notice renders here, at the seam, as the card's own
            // blocked press renders it.
            blockedPress: (block) =>
              blockedNotice(
                block,
                () =>
                  void capabilityNotices
                    .showEditingCapability()
                    .catch(passAborted),
              ),
          },
        });
        return reader;
      },
    })
    .useValue({ libraryScope: () => plainLibraryScope(runtime) })
    .useValue({
      query: () => bindQuery(bridge, runtime.runSync(QueryService)),
    })
    .useValue({ profile: () => plainProfile(runtime) })
    .useValue({ profileService: () => runtime.runSync(Profile) })
    .useValue({
      localBridge: () => bindLocalBridge(bridge, runtime.runSync(LocalBridge)),
    })
    .useValue({
      customize: () => bindCustomize(bridge, runtime.runSync(Customize)),
    })
    .useValue({
      templateData: () =>
        bindTemplateData(
          bridge,
          runtime.runSync(Effect.context<TemplateDataServices>()),
        ),
    })
    .useValue({
      templateMigration: () => {
        bindMigration({
          openPrompt: () => openWelcomeView(plugin.app),
        });
        return plainTemplateMigration(runtime);
      },
    })
    .useValue({
      itemLookup: () => bindItemLookup(bridge, runtime.runSync(ItemLookup)),
    })
    .useValue({
      noteFeature: (): NoteFeatureHandle =>
        bindNoteFeature(bridge, runtime.runSync(NoteFeature), {
          ...bindNoteCitations(
            bridge,
            runtime.runSync(Effect.context<NoteCitationServices>()),
          ),
          ...bindNoteCreation(
            bridge,
            runtime.runSync(Effect.context<NoteCreationServices>()),
            creation,
          ),
        }),
    })
    .useValue({
      // The Import profile command. Unload closes an open dialog, and the
      // caller sees it dismissed.
      importProfile: (): ImportProfile => {
        const runExit = exitOver(
          bridge,
          runtime.runSync(Effect.context<ProfileDialogServices>()),
        );
        return async (options) =>
          valueOr(await runExit(creation.importProfile(options)), undefined);
      },
    })
    .useValue({
      noteImportView: ({ targetOpener }) => {
        const noteImportView = createNoteImportView(plugin.app, creation);
        bindProtocolViews({ noteImportView, opener: targetOpener });
        return noteImportView;
      },
    })
    .useValue({
      batchImport: ({ noteImportView }) =>
        bindBatchImport(
          bridge,
          runtime.runSync(Effect.context<BatchImportServices>()),
          { view: noteImportView },
        ),
    })
    .useValue({
      noteActions: ({ noteImportView }) =>
        bindNoteActions(
          bridge,
          runtime.runSync(Effect.context<NoteActionServices>()),
          {
            creation,
            view: noteImportView,
            notices: batchUpdateNotices(plugin.app),
          },
        ),
    })
    .useValue({
      citationLookup: () => plainCitationLookup(runtime),
    })
    .useValue({
      citationParse: () => plainCitationParse(runtime),
    })
    .useValue({ citationParseService: () => runtime.runSync(CitationParse) })
    .useValue({ citationIndex: () => plainCitationIndex(runtime) })
    .useValue({
      pandocEngine: () =>
        bindManagedBinary(bridge, runtime.runSync(PandocEngine)),
    })
    .useValue({
      bibliographyRender: () => plainBibliographyRender(runtime),
    })
    .useValue({ citationText: () => plainCitationText(runtime) })
    .useValue({ citationPopover: () => runtime.runSync(CitationPopover) })
    .useValue({ annotationPopover: () => runtime.runSync(AnnotationPopover) })
    .useValue({ citekeyEditor: () => runtime.runSync(CitekeyEditor) })
    .useValue({ graphCitations: () => runtime.runSync(GraphCitations) });
}
