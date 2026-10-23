import type { FileSystemAdapter } from "obsidian";

import { cliRunner } from "@/lib/cli-command";
import { WEB_WORKBENCH_ENABLED } from "@/lib/constants";
import { DisposableAbortController } from "@/lib/disposables";
import { Effect } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { nodeFetch } from "@/lib/node-fetch";
import { workspaceOpenDocuments } from "@/lib/open-documents";
import { revealSetting } from "@/lib/open-settings";
import { libraryTagNames } from "@/services/database/library-tag-names";
import {
  createProfileCreator,
  createProfileImporter,
} from "@/setting-tab/profiles";
import { blockedNotice } from "@/views/annot-view/card-verbs";
import { createCommentRenderer } from "@/views/annot-view/comment-render";
import {
  annotationCardShown,
  revealAnnotationInView,
} from "@/views/annot-view/register";
import { openLibraryView } from "@/views/library/register";
import { openWelcomeView } from "@/views/welcome/register";
import type ZotLitPlugin from "@/zt-main";

import { AnnotationLinkReading } from "./annotation-popover/reading";
import { AnnotationPopover } from "./annotation-popover/service";
import { CapabilityNotices } from "./annotation-repository/notices";
import { AnnotationRepository } from "./annotation-repository/service";
import { AttachmentImportService } from "./attachment-import/service";
import { createPdfReader } from "./attachment-open/actions";
import { openWithSystem } from "./attachment-open/capture";
import { createTargetOpener } from "./attachment-open/open-target";
import { AttachmentResolver } from "./attachment-resolver/service";
import { createChineseSegmenterService } from "./chinese-segmenter/service";
import { CitationLookup } from "./citation-index/lookup-service";
import { CitationIndex } from "./citation-index/service";
import { plainCitationParse } from "./citation-parse/plain";
import { CitationPopover } from "./citation-popover/service";
import { CitationText } from "./citation-text/service";
import { CitekeyEditor } from "./citekey-editor/service";
import { CitekeyReading } from "./citekey-reading/service";
import { ExcerptDisplayService } from "./excerpt-image/display";
import { createExcerptPreparation } from "./excerpt-image/prepare";
import { prepareSingleExcerpt } from "./excerpt-image/prepare-single";
import type { ExcerptReaderDocuments } from "./excerpt-image/reader-borrow";
import { savedExcerptRequest } from "./excerpt-image/request";
import { ExcerptImageService } from "./excerpt-image/service";
import { openExcerptStore } from "./excerpt-image/store";
import { GraphCitations } from "./graph-citations/service";
import { ItemLookup } from "./item-lookup/service";
import { QueryService } from "./item-query/service";
import { LibraryScopeService } from "./library-scope/service";
import { LocalBridgeService } from "./local-bridge/service";
import { LocalServerService } from "./local-server/service";
import { createNoteFeature } from "./note-feature";
import type { NoteFeature } from "./note-feature";
import { createBatchImport } from "./note-import/batch-import";
import type { BatchImport } from "./note-import/batch-import";
import { createNoteImporter } from "./note-import/service";
import type { NoteImporter } from "./note-import/service";
import { createNoteImportView } from "./note-import/view";
import { NoteIndex } from "./note-index/service";
import { BibliographyRenderCache } from "./pandoc/render-cache";
import { createPandocEngineService } from "./pandoc/service";
import { PdfAnnotationEditor } from "./pdf-annotation-editor/service";
import { pluginLayer } from "./plugin-layer";
import { ProfileService } from "./profile/service";
import { QueryClients } from "./query-client/service";
import { ReleaseService } from "./release/service";
import { ServiceContainer } from "./service-base";
import { PluginSettings } from "./settings/service";
import {
  LiteratureNoteTemplateMigrationService,
  loadLiteratureNoteTemplateMigrationData,
} from "./template/migration";
import { TemplateService } from "./template/service";
import { plainUseLedger } from "./use-ledger/plain";
import { WikilinkEditor } from "./wikilink-editor/service";
import { WikilinkReading } from "./wikilink-reading/service";
import { writeReadUse } from "./zotero-local-api/last-read";
import { ZoteroLocalApiClient } from "./zotero-local-api/service";
import { SecretWriteAuthorizationStore } from "./zotero-local-api/write-authorization";
import { plainZoteroPref } from "./zotero-pref/plain";
import { ZoteroReadsService } from "./zotero-reads/service";
import { workerClient } from "./zotero-reads/worker-client";

/**
 * Construct and wire all Obsidian plugin services.
 *
 * This function does not own lifecycle. `zt-main.ts` creates the stack, passes
 * it here, and moves the stack only after all plugin startup wiring succeeds.
 *
 * The runtime over {@link pluginLayer} is built first, and the container
 * injects its services with `useValue`: a converted service through its plain
 * adapter, a bridged one as it is. The runtime's disposal sits under every
 * container registration on `stack`, so the whole graph closes after the last
 * container service has disposed: a container service never outlives a layer
 * it uses. A service leaves the container for the graph as it converts or is
 * bridged.
 *
 * Within the container, registration order matters: services dispose in LIFO.
 */
export function buildServices(
  plugin: ZotLitPlugin,
  stack: AsyncDisposableStack,
) {
  const runtime = buildRuntime(pluginLayer(plugin), stack);
  const container = new ServiceContainer(stack, (key, error) => {
    console.error(`Service "${key}" failed to initialize`, error);
  });

  // The excerpt service is registered before the PDF reader, so the reader
  // hands its documents over through this one holder. A crop asks for a reader
  // document per resolution, and answers detached while the holder is empty.
  let reader: PdfAnnotationEditor | undefined;
  const readers: ExcerptReaderDocuments = {
    borrow: (path) => reader?.borrowDocument(path) ?? null,
  };

  return container
    .useValue({
      settings: () => runtime.runSync(PluginSettings.use(Effect.succeed)),
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
      queryClient: () => runtime.runSync(QueryClients.use(Effect.succeed)),
    })
    .use({
      release: ({ settings }) =>
        new ReleaseService({
          app: plugin.app,
          version: plugin.manifest.version,
          settings,
          // A first install or an update opens the Library View, in place of
          // the empty tab or beside the open note.
          openFirstScreen: async () => {
            await openLibraryView(plugin.app, { pane: "first-screen" });
          },
        }),
    })
    .use({
      template: ({ settings }) =>
        new TemplateService({ app: plugin.app, settings }),
    })
    .use({
      noteIndex: () => new NoteIndex({ plugin, app: plugin.app }),
    })
    .useValue({
      zoteroPref: () => plainZoteroPref(runtime),
    })
    .use({
      localServer: ({ settings, zoteroPref, noteIndex }) =>
        new LocalServerService({ settings, zoteroPref, noteIndex }),
    })
    .use({
      chineseSegmenter: () => createChineseSegmenterService(plugin.app),
    })
    .use({
      // Interactive reads use their own worker; Citation Index bulk reads
      // use a second capability registered below.
      zoteroReads: ({ settings, zoteroPref, chineseSegmenter }) =>
        new ZoteroReadsService({
          client: workerClient({ settings, zoteroPref, chineseSegmenter }),
        }),
    })
    .use({
      excerptImage: () =>
        new ExcerptImageService({
          openStore: () => openExcerptStore(plugin.app.appId),
          readers,
        }),
    })
    .use({
      excerptDisplay: ({ queryClient, excerptImage }) =>
        new ExcerptDisplayService({
          queries: queryClient,
          resolve: (request, signal) => excerptImage.resolve(request, signal),
          stored: (request) => excerptImage.stored(request),
        }),
    })
    .use({
      attachmentResolver: ({ zoteroReads, queryClient, zoteroPref }) =>
        new AttachmentResolver({
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
          reader: createPdfReader({ app: plugin.app, settings }),
          native: openWithSystem,
          settings,
          // Desktop-only plugin: the adapter is always a `FileSystemAdapter`.
          vaultBasePath: (
            plugin.app.vault.adapter as FileSystemAdapter
          ).getBasePath(),
        }),
    })
    .use({
      zoteroLocalApi: ({ zoteroPref, localServer }) =>
        new ZoteroLocalApiClient({
          fetch: nodeFetch,
          zoteroPref,
          localServer,
          // The Remembered Write Authorization lives in Obsidian's Keychain,
          // where the user can see and delete it — never in synced settings.
          credentials: new SecretWriteAuthorizationStore({
            secrets: plugin.app.secretStorage,
          }),
        }),
    })
    .use({
      annotationRepository: ({
        zoteroReads,
        queryClient,
        zoteroLocalApi,
        zoteroPref,
        excerptImage,
      }) =>
        new AnnotationRepository({
          db: zoteroReads,
          queryClient,
          localApi: zoteroLocalApi,
          // A session's first read of an Attachment has no list that stood
          // before it to compare against, so it is compared against the image
          // this device persists for the Annotation instead — the display's own
          // stored-outcome read, so an Annotation this device never cached has
          // no baseline here exactly as it has no image to replace there.
          persistedExcerpt: async (annotation, source) => {
            const request = await savedExcerptRequest({
              annotation,
              source,
              sourceScope: zoteroPref.dataDir,
              zoteroReads,
              paths: zoteroPref,
            });
            if (!request) return null;
            return (
              (await excerptImage.stored(request))?.identity.fingerprint ?? null
            );
          },
        }),
    })
    .use({
      capabilityNotices: ({ annotationRepository, zoteroLocalApi }) =>
        new CapabilityNotices({
          capabilities: annotationRepository,
          writes: zoteroLocalApi,
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
        zoteroReads,
        noteIndex,
        settings,
      }) => {
        reader = new PdfAnnotationEditor({
          recordRead: ({ attachmentKey, itemKey, serverID, instant }) => {
            useLedger.record(itemKey, "read", instant);
            void writeReadUse(
              { reads: zoteroReads, api: zoteroLocalApi },
              { attachmentKey, instant, serverID },
            );
          },
          app: plugin.app,
          attachments: attachmentResolver,
          annotations: annotationRepository,
          noteIndex,
          libraryTagNames: (annotationKey) =>
            libraryTagNames(zoteroReads, annotationKey),
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
        new AttachmentImportService({ app: plugin.app, settings, zoteroPref }),
    })
    .use({
      libraryScope: ({ zoteroReads, queryClient, settings }) =>
        new LibraryScopeService({
          reads: zoteroReads,
          queries: queryClient,
          settings,
        }),
    })
    .use({
      query: ({ zoteroReads, libraryScope, zoteroPref, useLedger }) =>
        new QueryService({
          pluginVersion: plugin.manifest.version,
          reads: zoteroReads,
          libraryScope,
          zoteroPref,
          vault: plugin.app.vault,
          useLedger,
        }),
    })
    .use({
      profile: ({ settings, template, noteIndex }) =>
        new ProfileService({
          app: plugin.app,
          settings,
          template,
          noteIndex,
        }),
    })
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
    .use({
      templateMigration: ({
        zoteroReads,
        libraryScope,
        noteIndex,
        settings,
        template,
        zoteroPref,
      }) =>
        new LiteratureNoteTemplateMigrationService({
          app: plugin.app,
          settings,
          template,
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
          openPrompt: () => openWelcomeView(plugin.app, settings),
        }),
    })
    .use({
      itemLookup: ({ zoteroReads, libraryScope, useLedger }) =>
        new ItemLookup({ reads: zoteroReads, libraryScope, useLedger }),
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
        template,
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
          libraryScope,
          noteImport,
          noteIndex,
          metadataCache: plugin.app.metadataCache,
          template,
        }),
    })
    .use({
      citationLookup: ({ zoteroReads, libraryScope, queryClient }) =>
        new CitationLookup({ reads: zoteroReads, libraryScope, queryClient }),
    })
    .useValue({
      citationParse: () => plainCitationParse(runtime),
    })
    .use({
      citationIndex: ({
        noteIndex,
        settings,
        citationLookup,
        citationParse,
        zoteroReads,
        libraryScope,
      }) =>
        new CitationIndex({
          runPromise: (effect) => runtime.runPromise(effect),
          db: zoteroReads,
          libraryScope,
          app: plugin.app,
          noteIndex,
          settings,
          lookup: citationLookup,
          parseClient: citationParse,
        }),
    })
    .use({
      pandocEngine: () => createPandocEngineService(plugin.app),
    })
    .use({
      bibliographyRender: ({
        zoteroReads,
        pandocEngine,
        zoteroPref,
        settings,
        profile,
        queryClient,
      }) =>
        new BibliographyRenderCache({
          profile,
          db: zoteroReads,
          pandocEngine,
          zoteroPref,
          settings,
          queryClient,
        }),
    })
    .use({
      citationText: ({
        profile,
        citationIndex,
        citationLookup,
        noteIndex,
        bibliographyRender,
        queryClient,
      }) =>
        new CitationText({
          profile,
          app: plugin.app,
          citationIndex,
          citationLookup,
          noteIndex,
          bibliographyRender,
          queryClient,
          openDocuments: workspaceOpenDocuments(plugin.app),
        }),
    })
    .use({
      citationPopover: ({
        profile,
        zoteroReads,
        citationIndex,
        citationLookup,
        citationText,
        bibliographyRender,
        libraryScope,
      }): CitationPopover =>
        new CitationPopover({
          profile,
          app: plugin.app,
          db: zoteroReads,
          citationIndex,
          citationLookup,
          citationText,
          bibliographyRender,
          libraryScope,
        }),
    })
    .use({
      annotationPopover: ({
        annotationRepository,
        excerptDisplay,
        zoteroReads,
        zoteroPref,
      }) =>
        new AnnotationPopover({
          annotations: annotationRepository,
          excerptDisplay,
          excerptRequest: ({ annotation, source }) =>
            savedExcerptRequest({
              annotation,
              source,
              sourceScope: zoteroPref.dataDir,
              zoteroReads,
              paths: zoteroPref,
            }),
          commentRenderer: (owner, sourcePath) =>
            createCommentRenderer({
              app: plugin.app,
              component: owner,
              getSourcePath: () => sourcePath,
            }),
        }),
    })
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
      }) =>
        new CitekeyEditor({
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
        }),
    })
    .use({
      annotationLinkReading: ({ annotationPopover, settings }) =>
        new AnnotationLinkReading({
          app: plugin.app,
          plugin,
          settings,
          annotationPopover,
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
      }) =>
        new WikilinkEditor({
          app: plugin.app,
          plugin,
          noteIndex,
          citationText,
          citekeyEditor,
          citationPopover,
          settings,
          citationLookup,
        }),
    })
    .use({
      wikilinkReading: ({
        noteIndex,
        citationText,
        citekeyEditor,
        citationPopover,
        settings,
      }) =>
        new WikilinkReading({
          app: plugin.app,
          plugin,
          noteIndex,
          citationText,
          citekeyEditor,
          citationPopover,
          settings,
        }),
    })
    .use({
      citekeyReading: ({
        citationText,
        citationLookup,
        citationPopover,
        citekeyEditor,
        settings,
      }) =>
        new CitekeyReading({
          app: plugin.app,
          plugin,
          citationText,
          citationLookup,
          citationPopover,
          citekeyEditor,
          settings,
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
      }) =>
        new GraphCitations({
          app: plugin.app,
          reads: zoteroReads,
          libraryScope,
          citationIndex,
          citationLookup,
          noteIndex,
          citekeyEditor,
          citationPopover,
          settings,
        }),
    });
}
