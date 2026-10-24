import type { FileSystemAdapter } from "obsidian";

import { cliRunner } from "@/lib/cli-command";
import { WEB_WORKBENCH_ENABLED } from "@/lib/constants";
import { DisposableAbortController } from "@/lib/disposables";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { revealSetting } from "@/lib/open-settings";
import { libraryTagNamesOf } from "@/services/database/library-tag-names";
import {
  createProfileCreator,
  createProfileImporter,
} from "@/setting-tab/profiles";
import { blockedNotice } from "@/views/annot-view/card-verbs";
import {
  annotationCardShown,
  revealAnnotationInView,
} from "@/views/annot-view/register";
import { openWelcomeView } from "@/views/welcome/register";
import type ZotLitPlugin from "@/zt-main";

import { AnnotationPopover } from "./annotation-popover/service";
import { CapabilityNotices } from "./annotation-repository/notices";
import { AnnotationRepository } from "./annotation-repository/service";
import { AttachmentImportService } from "./attachment-import/service";
import { createPdfReader } from "./attachment-open/actions";
import { openWithSystem } from "./attachment-open/capture";
import { createTargetOpener } from "./attachment-open/open-target";
import { AttachmentResolver } from "./attachment-resolver/service";
import { ChineseSegmenter } from "./chinese-segmenter/service";
import {
  plainCitationIndex,
  plainCitationLookup,
} from "./citation-index/plain";
import { plainCitationParse } from "./citation-parse/plain";
import { CitationPopover } from "./citation-popover/service";
import { plainCitationText } from "./citation-text/plain";
import { CitekeyEditor } from "./citekey-editor/service";
import { CitekeyReading } from "./citekey-reading/service";
import { ExcerptDisplays } from "./excerpt-image/display";
import { ExcerptImages } from "./excerpt-image/layer";
import { createExcerptPreparation } from "./excerpt-image/prepare";
import { prepareSingleExcerpt } from "./excerpt-image/prepare-single";
import type { ExcerptReaderDocuments } from "./excerpt-image/reader-borrow";
import { openExcerptStore } from "./excerpt-image/store";
import { GraphCitations } from "./graph-citations/service";
import { ItemLookup } from "./item-lookup/service";
import { QueryService } from "./item-query/service";
import { plainLibraryScope } from "./library-scope/plain";
import { LocalBridgeService } from "./local-bridge/service";
import { LocalServer } from "./local-server/service";
import { bindManagedBinary } from "./managed-binary/handle";
import { createNoteFeature } from "./note-feature";
import type { NoteFeature } from "./note-feature";
import { createBatchImport } from "./note-import/batch-import";
import type { BatchImport } from "./note-import/batch-import";
import { createNoteImporter } from "./note-import/service";
import type { NoteImporter } from "./note-import/service";
import { createNoteImportView } from "./note-import/view";
import { plainNoteIndex } from "./note-index/plain";
import { plainBibliographyRender } from "./pandoc/render-cache/plain";
import { PandocEngine } from "./pandoc/service";
import { PdfAnnotationEditor } from "./pdf-annotation-editor/service";
import { pluginLayer } from "./plugin-layer";
import { plainProfile } from "./profile/plain";
import { plainQueryClients } from "./query-client/plain";
import { Release } from "./release/service";
import { ServiceContainer } from "./service-base";
import { PluginSettings } from "./settings/service";
import { loadLiteratureNoteTemplateMigrationData } from "./template/migration";
import type { TemplateMigrationOptions } from "./template/migration";
import { plainTemplate, plainTemplateMigration } from "./template/plain";
import { plainUseLedger } from "./use-ledger/plain";
import { WikilinkEditor } from "./wikilink-editor/service";
import { WikilinkReading } from "./wikilink-reading/service";
import { writeReadUse } from "./zotero-local-api/last-read";
import { localApiPort } from "./zotero-local-api/port";
import { ZoteroLocalApi } from "./zotero-local-api/service";
import { plainZoteroPref } from "./zotero-pref/plain";
import { plainZoteroReads } from "./zotero-reads/plain";
import { ZoteroReads } from "./zotero-reads/service";

/**
 * Construct and wire all Obsidian plugin services.
 *
 * This function does not own lifecycle. `zt-main.ts` creates the stack, passes
 * it here, and moves the stack only after all plugin startup wiring succeeds.
 *
 * The runtime over {@link pluginLayer} finishes acquisition first, including
 * each layer's asynchronous first load. The container then
 * injects its services with `useValue`: a converted service through its plain
 * adapter, a bridged one as it is. The runtime's disposal sits under every
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
) {
  let bindMigration!: (actions: TemplateMigrationOptions) => void;
  const migrationActions = new Promise<TemplateMigrationOptions>((resolve) => {
    bindMigration = resolve;
  });
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
        loadVerificationData: async (options) =>
          (await migrationActions).loadVerificationData(options),
        openPrompt: async () => (await migrationActions).openPrompt(),
      },
      {
        openStore: () => openExcerptStore(plugin.app.appId),
        readers,
      },
    ),
    stack,
  );
  await runtime.context();
  const bridge = effectBridge(runtime);
  const zoteroReadsService = runtime.runSync(ZoteroReads);
  const zoteroLocalApiService = runtime.runSync(ZoteroLocalApi);
  const localApi = localApiPort(zoteroLocalApiService, bridge);
  const container = new ServiceContainer(stack, (key, error) => {
    console.error(`Service "${key}" failed to initialize`, error);
  });

  return container
    .useValue({ runtime: () => runtime })
    .useValue({ bridge: () => bridge })
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
    .useValue({ excerptImage: () => runtime.runSync(ExcerptImages) })
    .useValue({ excerptDisplay: () => runtime.runSync(ExcerptDisplays) })
    .use({
      attachmentResolver: ({ zoteroReads, queryClient, zoteroPref }) =>
        new AttachmentResolver({
          runtime,
          reads: zoteroReads,
          queries: queryClient,
          zoteroPref,
        }),
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
    .useValue({ zoteroLocalApi: () => zoteroLocalApiService })
    .useValue({
      annotationRepository: () => runtime.runSync(AnnotationRepository),
    })
    .use({
      capabilityNotices: ({ annotationRepository }) =>
        new CapabilityNotices({
          capabilities: annotationRepository,
          bridge,
          writes: localApi,
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
        }),
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
            void writeReadUse(
              {
                reads: zoteroReadsService,
                bridge,
                api: zoteroLocalApi,
              },
              { attachmentKey, instant, serverID },
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
            allowEditing: () => void capabilityNotices.showEditingCapability(),
          },
          markGestures: {
            revealAnnotation: (annotationKey) =>
              void revealAnnotationInView(plugin, annotationKey),
            // The notice renders here, at the seam, as the card's own
            // blocked press renders it.
            blockedPress: (block) =>
              blockedNotice(
                block,
                () => void capabilityNotices.showEditingCapability(),
              ),
          },
        });
        return reader;
      },
    })
    .use({
      attachmentImport: ({ settings, zoteroPref }) =>
        new AttachmentImportService({
          bridge,
          app: plugin.app,
          settings,
          zoteroPref,
        }),
    })
    .useValue({ libraryScope: () => plainLibraryScope(runtime) })
    .use({
      query: ({ zoteroReads, libraryScope, zoteroPref, useLedger }) =>
        new QueryService({
          runtime,
          pluginVersion: plugin.manifest.version,
          reads: zoteroReads,
          libraryScope,
          zoteroPref,
          vault: plugin.app.vault,
          useLedger,
        }),
    })
    .useValue({ profile: () => plainProfile(runtime) })
    .use({
      localBridge: ({
        settings,
        profile,
        localServer,
        zoteroReads,
        noteIndex,
        template,
        zoteroPref,
      }) =>
        new LocalBridgeService({
          bridge,
          webWorkbenchEnabled: WEB_WORKBENCH_ENABLED,
          app: plugin.app,
          settings,
          profile,
          localServer,
          zoteroReads,
          noteIndex,
          template,
          zoteroPref,
          pluginVersion: plugin.manifest.version,
        }),
    })
    .useValue({
      noteImport: ({
        profile,
        noteIndex,
        template,
        zoteroPref,
        attachmentImport,
        excerptImage,
      }): NoteImporter =>
        createNoteImporter({
          profile,
          app: plugin.app,
          noteIndex,
          template,
          zoteroPref,
          attachmentImport,
          excerptImages: (options) =>
            createExcerptPreparation({
              app: plugin.app,
              resolver: excerptImage,
              paths: {
                dataDir: zoteroPref.dataDir,
                baseAttachmentPath: zoteroPref.baseAttachmentPath,
              },
            })(options),
        }),
    })
    .useValue({
      templateMigration: ({
        zoteroReads,
        libraryScope,
        noteIndex,
        settings,
        template,
        zoteroPref,
      }) => {
        bindMigration({
          loadVerificationData: (options) =>
            loadLiteratureNoteTemplateMigrationData(
              {
                app: plugin.app,
                zoteroReads,
                libraryScope,
                noteIndex,
                settings,
                templates: template,
                zoteroPref,
              },
              options,
            ),
          openPrompt: () => openWelcomeView(plugin.app, settings, bridge),
        });
        return plainTemplateMigration(runtime);
      },
    })
    .use({
      itemLookup: ({ zoteroReads, libraryScope, useLedger }) =>
        new ItemLookup({
          runtime,
          reads: zoteroReads,
          libraryScope,
          useLedger,
        }),
    })
    .useValue({
      noteFeature: ({
        excerptImage,
        profile,
        template,
        zoteroReads,
        query,
        noteIndex,
        zoteroPref,
        settings,
        attachmentImport,
      }): NoteFeature =>
        createNoteFeature({
          singleExcerpt: (options) =>
            prepareSingleExcerpt({
              ...options,
              app: plugin.app,
              resolver: excerptImage,
            }),
          excerptImages: (options) =>
            createExcerptPreparation({
              app: plugin.app,
              resolver: excerptImage,
              paths: {
                dataDir: zoteroPref.dataDir,
                baseAttachmentPath: zoteroPref.baseAttachmentPath,
              },
            })(options),
          profile,
          app: plugin.app,
          template,
          zoteroReads,
          query,
          noteIndex,
          zoteroPref,
          settings,
          bridge,
          attachmentImport,
        }),
    })
    .useValue({
      createProfile: ({
        profile,
        template,
        zoteroReads,
        noteIndex,
        zoteroPref,
        settings,
        libraryScope,
        noteFeature,
      }) =>
        createProfileCreator({
          app: plugin.app,
          profile,
          template,
          zoteroReads,
          noteIndex,
          zoteroPref,
          settings,
          libraryScope,
          noteFeature,
        }),
    })
    .useValue({
      importProfile: ({
        profile,
        template,
        zoteroReads,
        noteIndex,
        zoteroPref,
        settings,
        libraryScope,
        noteFeature,
      }) =>
        createProfileImporter({
          app: plugin.app,
          profile,
          template,
          zoteroReads,
          noteIndex,
          zoteroPref,
          settings,
          libraryScope,
          noteFeature,
        }),
    })
    .useValue({
      batchImport: ({
        profile,
        noteFeature,
        createProfile,
        importProfile,
        zoteroPref,
        zoteroReads,
        settings,
        libraryScope,
        noteImport,
        noteIndex,
      }): BatchImport =>
        createBatchImport({
          view: createNoteImportView(plugin.app, {
            createProfile,
            importProfile,
            zoteroPref,
          }),
          profile,
          noteFeature,
          zoteroReads,
          settings,
          bridge,
          libraryScope,
          noteImport,
          noteIndex,
          metadataCache: plugin.app.metadataCache,
        }),
    })
    .useValue({
      citationLookup: () => plainCitationLookup(runtime),
    })
    .useValue({
      citationParse: () => plainCitationParse(runtime),
    })
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
    .use({
      citekeyEditor: ({
        noteIndex,
        noteFeature,
        createProfile,
        importProfile,
        zoteroPref,
        zoteroReads,
        citationText,
        citationPopover,
        annotationPopover,
        settings,
        citationLookup,
        libraryScope,
        bridge,
      }) =>
        new CitekeyEditor({
          runtime,
          app: plugin.app,
          plugin,
          noteIndex,
          noteFeature,
          createProfile,
          importProfile,
          zoteroPref,
          db: zoteroReads,
          citationText,
          citationPopover,
          annotationPopover,
          settings,
          citationLookup,
          libraryScope,
          bridge,
        }),
    })
    .use({
      wikilinkEditor: ({
        noteIndex,
        citationText,
        citekeyEditor,
        citationPopover,
        settings,
        citationLookup,
        bridge,
      }) =>
        new WikilinkEditor({
          runtime,
          app: plugin.app,
          plugin,
          noteIndex,
          citationText,
          citekeyEditor,
          citationPopover,
          settings,
          citationLookup,
          bridge,
        }),
    })
    .use({
      wikilinkReading: ({
        noteIndex,
        citationText,
        citekeyEditor,
        citationPopover,
        settings,
        bridge,
      }) =>
        new WikilinkReading({
          runtime,
          app: plugin.app,
          plugin,
          noteIndex,
          citationText,
          citekeyEditor,
          citationPopover,
          settings,
          bridge,
        }),
    })
    .use({
      citekeyReading: ({
        citationText,
        citationLookup,
        citationPopover,
        citekeyEditor,
        settings,
        bridge,
      }) =>
        new CitekeyReading({
          runtime,
          app: plugin.app,
          plugin,
          citationText,
          citationLookup,
          citationPopover,
          citekeyEditor,
          settings,
          bridge,
        }),
    })
    .use({
      graphCitations: ({
        zoteroReads,
        libraryScope,
        citationIndex,
        citationLookup,
        noteIndex,
        citekeyEditor,
        citationPopover,
        settings,
        bridge,
      }) =>
        new GraphCitations({
          runtime,
          app: plugin.app,
          reads: zoteroReads,
          libraryScope,
          citationIndex,
          citationLookup,
          noteIndex,
          citekeyEditor,
          citationPopover,
          settings,
          bridge,
        }),
    });
}
