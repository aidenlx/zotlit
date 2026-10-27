import { Effect, FileSystem } from "effect";

import { cliRunner } from "@/lib/cli-command";
import { WEB_WORKBENCH_ENABLED } from "@/lib/constants";
import { DisposableAbortController } from "@/lib/disposables";
import { effectBridge, exitOver, valueOr } from "@/lib/effect-bridge";
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
import { bindLiteratureNoteAttachments } from "./attachment-open/handle";
import type { LiteratureNoteServices } from "./attachment-open/literature-note";
import { TargetOpener } from "./attachment-open/open-target";
import { AttachmentResolver } from "./attachment-resolver/service";
import { ChineseSegmenter } from "./chinese-segmenter/service";
import { CitationLookup } from "./citation-index/lookup-service";
import { CitationIndex } from "./citation-index/service";
import { CitationParse } from "./citation-parse/service";
import { CitationPopover } from "./citation-popover/service";
import { CitationText } from "./citation-text/service";
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
import { LibraryScope } from "./library-scope/service";
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
import { AnnotationNoteActions } from "./note-feature/view-actions";
import type { BatchImportServices } from "./note-import/batch-import";
import { bindBatchImport } from "./note-import/batch-import-handle";
import { createNoteImportView } from "./note-import/view";
import { NoteIndex } from "./note-index/service";
import { PandocEngine } from "./pandoc/service";
import { PdfAnnotationEditor } from "./pdf-annotation-editor/service";
import { pluginLayer } from "./plugin-layer";
import { Profile } from "./profile/service";
import type { ProtocolDeps } from "./protocol/register";
import { QueryClients } from "./query-client/service";
import { Release } from "./release/service";
import { PluginSettings } from "./settings/service";
import type { TemplateDataServices } from "./template-workbench/data";
import { bindTemplateData } from "./template-workbench/data-handle";
import type { TemplateMigrationOptions } from "./template/migration";
import { Template } from "./template/service";
import { UseLedger } from "./use-ledger/service";
import { ZoteroLocalApi } from "./zotero-local-api/service";
import { ZoteroPref } from "./zotero-pref/service";
import { acquireReadLease } from "./zotero-reads/lease";
import { ZoteroReads } from "./zotero-reads/service";

/** What the protocol handlers open: the note import's modals. */
type ProtocolViews = Pick<ProtocolDeps, "noteImportView">;

/**
 * Compose the plugin's runtime over {@link pluginLayer} and bind the values
 * the plugin shell and the debug surface read.
 *
 * This function does not own lifecycle. `zt-main.ts` creates the stack, passes
 * it here, and moves the stack only after all plugin startup wiring succeeds.
 * Two entries go on `stack`: the runtime's disposal, before acquisition
 * starts, and then the CLI runner's abort. Everything the shell registers
 * after this sits above both, so unload runs the shell's cleanup first, then
 * interrupts a running command, and closes the graph last.
 *
 * The runtime finishes acquisition first, including each layer's
 * asynchronous first load, so every value read here has finished acquiring.
 * A throw anywhere in here leaves the graph on `stack` for the caller's
 * rollback.
 */
export async function createPluginRuntime(
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
  // The protocol handlers open the note import's modals, which are built
  // after the graph.
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
  };
  // The excerpt service is registered before the PDF reader, so the reader
  // hands its documents over through this one holder. A crop asks for a reader
  // document per resolution, and answers detached while the holder is empty.
  const readers: ExcerptReaderDocuments = { borrow: () => null };
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
        pdfEditor: {
          revealAnnotation: (key) => void revealAnnotationInView(plugin, key),
          blockedPress: blockedNotice,
          readers,
        },
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
  bindMigration({ openPrompt: () => openWelcomeView(plugin.app) });
  const bridge = effectBridge(runtime);
  // Above the runtime on the stack, so unload interrupts a command still
  // running before the services it reads dispose.
  const runCli = cliRunner(
    runtime,
    stack.use(new DisposableAbortController()).signal,
  );

  const settings = runtime.runSync(PluginSettings);
  const zoteroReads = runtime.runSync(ZoteroReads);
  const attachmentResolver = runtime.runSync(AttachmentResolver);
  const citationLookup = runtime.runSync(CitationLookup);
  const citationIndex = runtime.runSync(CitationIndex);
  const useLedger = runtime.runSync(UseLedger);
  const zoteroPrefService = runtime.runSync(ZoteroPref);
  const notifier = runtime.runSync(Notifier);
  const pandocEngine = runtime.runSync(PandocEngine);
  const noteFeature: NoteFeatureHandle = bindNoteFeature(
    bridge,
    runtime.runSync(NoteFeature),
    {
      ...bindNoteCitations(
        bridge,
        runtime.runSync(Effect.context<NoteCitationServices>()),
      ),
      ...bindNoteCreation(
        bridge,
        runtime.runSync(Effect.context<NoteCreationServices>()),
        creation,
      ),
    },
  );
  // The Import profile command. Unload closes an open dialog, and the caller
  // sees it dismissed.
  const runProfileDialog = exitOver(
    bridge,
    runtime.runSync(Effect.context<ProfileDialogServices>()),
  );
  const importProfile: ImportProfile = async (options) =>
    valueOr(await runProfileDialog(creation.importProfile(options)), undefined);
  const noteImportView = createNoteImportView(plugin.app, creation);
  bindProtocolViews({ noteImportView });

  return {
    runtime,
    bridge,
    annotationNotes: runtime.runSync(AnnotationNoteActions),
    workspace: runtime.runSync(Workspace),
    metadataCache: runtime.runSync(MetadataCache),
    notifier,
    zoteroPrefService,
    fileSystem: runtime.runSync(FileSystem.FileSystem),
    settings,
    useLedger,
    runCli,
    queryClient: runtime.runSync(QueryClients),
    release: runtime.runSync(Release),
    template: runtime.runSync(Template),
    noteIndex: runtime.runSync(NoteIndex),
    localServer: runtime.runSync(LocalServer),
    zoteroHttp: runtime.runSync(ZoteroHttp),
    chineseSegmenter: bindManagedBinary(
      bridge,
      runtime.runSync(ChineseSegmenter),
    ),
    zoteroReads,
    acquireZoteroRead: () => acquireReadLease(zoteroReads, bridge),
    libraryTagNames: libraryTagNamesOf(runtime),
    excerptImage: runtime.runSync(ExcerptImageService),
    excerptDisplay: runtime.runSync(ExcerptDisplays),
    attachmentResolver,
    targetOpener: runtime.runSync(TargetOpener),
    literatureNoteAttachments: bindLiteratureNoteAttachments(
      bridge,
      runtime.runSync(Effect.context<LiteratureNoteServices>()),
    ),
    zoteroLocalApi: runtime.runSync(ZoteroLocalApi),
    annotationRepository: runtime.runSync(AnnotationRepository),
    capabilityNotices: bindCapabilityNotices(
      bridge,
      runtime.runSync(CapabilityNotices),
    ),
    pdfAnnotationEditor: runtime.runSync(PdfAnnotationEditor),
    libraryScope: runtime.runSync(LibraryScope),
    query: bindQuery(bridge, runtime.runSync(QueryService)),
    profileService: runtime.runSync(Profile),
    localBridge: bindLocalBridge(bridge, runtime.runSync(LocalBridge)),
    customize: bindCustomize(bridge, runtime.runSync(Customize)),
    templateData: bindTemplateData(
      bridge,
      runtime.runSync(Effect.context<TemplateDataServices>()),
    ),
    itemLookup: bindItemLookup(bridge, runtime.runSync(ItemLookup)),
    noteFeature,
    importProfile,
    noteImportView,
    batchImport: bindBatchImport(
      bridge,
      runtime.runSync(Effect.context<BatchImportServices>()),
      { view: noteImportView },
    ),
    noteActions: bindNoteActions(
      bridge,
      runtime.runSync(Effect.context<NoteActionServices>()),
      {
        creation,
        view: noteImportView,
        notices: batchUpdateNotices(plugin.app),
      },
    ),
    citationLookup,
    citationParseService: runtime.runSync(CitationParse),
    citationIndex,
    citationSuggestServices: { citationLookup, citationIndex, useLedger },
    pandocExportServices: {
      db: zoteroReads,
      citationLookup,
      zoteroPref: zoteroPrefService,
      pandocEngine,
      notifier,
    },
    pandocEngine: bindManagedBinary(bridge, pandocEngine),
    citationText: runtime.runSync(CitationText),
    citationPopover: runtime.runSync(CitationPopover),
    annotationPopover: runtime.runSync(AnnotationPopover),
    citekeyEditor: runtime.runSync(CitekeyEditor),
    graphCitations: runtime.runSync(GraphCitations),
  };
}
