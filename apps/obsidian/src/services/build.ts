import { WEB_WORKBENCH_ENABLED } from "@/lib/constants";
import { nodeFetch } from "@/lib/node-fetch";
import { revealSetting } from "@/lib/open-settings";
import {
  createProfileCreator,
  createProfileImporter,
} from "@/setting-tab/profiles";
import {
  annotationCardShown,
  revealAnnotationInView,
} from "@/views/annot-view/register";
import { openWelcomeView } from "@/views/welcome/register";
import type ZotLitPlugin from "@/zt-main";

import { CapabilityNotices } from "./annotation-repository/notices";
import { AnnotationRepository } from "./annotation-repository/service";
import { AttachmentImportService } from "./attachment-import/service";
import { AttachmentResolver } from "./attachment-resolver/service";
import { CitationIndex } from "./citation-index/service";
import { CitationPopover } from "./citation-popover/service";
import { CitationText } from "./citation-text/service";
import { CitekeyEditor } from "./citekey-editor/service";
import { CitekeyReading } from "./citekey-reading/service";
import { DatabaseService } from "./database/service";
import { ExcerptDisplayService } from "./excerpt-image/display";
import { createExcerptPreparation } from "./excerpt-image/prepare";
import { prepareSingleExcerpt } from "./excerpt-image/prepare-single";
import type { ExcerptReaderDocuments } from "./excerpt-image/reader-borrow";
import { savedExcerptRequest } from "./excerpt-image/request";
import { ExcerptImageService } from "./excerpt-image/service";
import { openExcerptStore } from "./excerpt-image/store";
import { GraphCitations } from "./graph-citations/service";
import { getChsSegmenter } from "./item-lookup/chs-segmenter";
import { ItemLookup } from "./item-lookup/service";
import { LibraryScopeService } from "./library-scope/service";
import { LocalBridgeService } from "./local-bridge/service";
import { LocalServerService } from "./local-server/service";
import { LoggingService } from "./log/service";
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
import { ProfileService } from "./profile/service";
import { QueryClientService } from "./query-client/service";
import { ReleaseService } from "./release/service";
import { ServiceContainer } from "./service-base";
import {
  migrateLegacyV0,
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
  migrateV6ToV7,
  migrateV7ToV8,
  migrateV8ToV9,
  migrateV9ToV10,
} from "./settings/migrate";
import { SettingsService } from "./settings/service";
import {
  LiteratureNoteTemplateMigrationService,
  loadLiteratureNoteTemplateMigrationData,
} from "./template/migration";
import { TemplateService } from "./template/service";
import { WikilinkEditor } from "./wikilink-editor/service";
import { WikilinkReading } from "./wikilink-reading/service";
import { ZoteroLocalApiClient } from "./zotero-local-api/service";
import { SecretWriteAuthorizationStore } from "./zotero-local-api/write-authorization";
import { ZoteroPrefService } from "./zotero-pref/service";

/**
 * Construct and wire all Obsidian plugin services.
 *
 * This function does not own lifecycle. `zt-main.ts` creates the stack, passes
 * it here, and moves the stack only after all plugin startup wiring succeeds.
 *
 * Registration order matters: services dispose in LIFO. `log` is registered
 * after `settings` so it shuts down (flushing the file sink) before settings
 * drains its pending writes.
 */
export function buildServices(
  plugin: ZotLitPlugin,
  stack: AsyncDisposableStack,
) {
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
    .use({
      settings: () =>
        new SettingsService({
          plugin,
          migrateLegacy: migrateLegacyV0,
          migrateV1: migrateV1ToV2,
          migrateV2: migrateV2ToV3,
          migrateV3: migrateV3ToV4,
          migrateV4: migrateV4ToV5,
          migrateV5: migrateV5ToV6,
          migrateV6: migrateV6ToV7,
          migrateV7: migrateV7ToV8,
          migrateV8: migrateV8ToV9,
          migrateV9: migrateV9ToV10,
        }),
    })
    .use({
      log: ({ settings }) => new LoggingService({ plugin, settings }),
    })
    .use({
      queryClient: () => new QueryClientService(),
    })
    .use({
      release: ({ settings }) =>
        new ReleaseService({
          app: plugin.app,
          version: plugin.manifest.version,
          settings,
          openWelcomeView: (mode) => openWelcomeView(plugin.app, mode),
        }),
    })
    .use({
      template: ({ settings }) =>
        new TemplateService({ app: plugin.app, settings }),
    })
    .use({
      noteIndex: () => new NoteIndex({ plugin, app: plugin.app }),
    })
    .use({
      zoteroPref: () => new ZoteroPrefService({ app: plugin.app }),
    })
    .use({
      localServer: ({ settings, zoteroPref, noteIndex }) =>
        new LocalServerService({ settings, zoteroPref, noteIndex }),
    })
    .use({
      db: ({ settings, zoteroPref }) =>
        new DatabaseService({ settings, zoteroPref }),
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
      attachmentResolver: ({ db, zoteroPref }) =>
        new AttachmentResolver({ db, zoteroPref }),
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
        db,
        queryClient,
        zoteroLocalApi,
        zoteroPref,
        excerptImage,
      }) =>
        new AnnotationRepository({
          db,
          queryClient,
          localApi: zoteroLocalApi,
          // A session's first read of an Attachment has no list that stood
          // before it to compare against, so it is compared against the image
          // this device persists for the Annotation instead — the display's own
          // stored-outcome read, so an Annotation this device never cached has
          // no baseline here exactly as it has no image to replace there.
          persistedExcerpt: async (annotation, source) => {
            const request = savedExcerptRequest({
              annotation,
              source,
              sourceScope: zoteroPref.dataDir,
              db,
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
            void revealAnnotationInView(plugin, annotationKey, {
              comment: false,
            }),
        }),
    })
    .use({
      pdfAnnotationEditor: ({
        attachmentResolver,
        annotationRepository,
        capabilityNotices,
        settings,
      }) => {
        reader = new PdfAnnotationEditor({
          app: plugin.app,
          attachments: attachmentResolver,
          annotations: annotationRepository,
          settings,
          capabilityGestures: {
            reportBlockedGesture: (attachmentKey) =>
              capabilityNotices.reportBlockedGesture(attachmentKey),
          },
          markGestures: {
            revealAnnotation: (annotationKey, options) =>
              void revealAnnotationInView(plugin, annotationKey, options),
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
      libraryScope: ({ db, settings }) =>
        new LibraryScopeService({ db, settings }),
    })
    .use({
      profile: ({ settings, template, noteIndex, libraryScope }) =>
        new ProfileService({
          app: plugin.app,
          settings,
          template,
          noteIndex,
          libraryScope,
        }),
    })
    .use({
      localBridge: ({
        settings,
        profile,
        localServer,
        db,
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
          db,
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
        db,
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
                db,
                libraryScope,
                noteIndex,
                settings,
                templates: template,
                zoteroPref,
              },
              options,
            ),
          openPrompt: () => openWelcomeView(plugin.app, "upgraded"),
        }),
    })
    .use({
      itemLookup: ({ db, libraryScope }) =>
        new ItemLookup({
          db,
          libraryScope,
          getChsSegmenter: () => getChsSegmenter(plugin.app),
        }),
    })
    .useValue({
      noteFeature: ({
        excerptImage,
        profile,
        template,
        db,
        noteIndex,
        zoteroPref,
        settings,
        attachmentImport,
        noteImport,
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
          db,
          noteIndex,
          zoteroPref,
          settings,
          attachmentImport,
          noteImport,
        }),
    })
    .useValue({
      createProfile: ({
        profile,
        template,
        db,
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
          db,
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
        db,
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
          db,
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
        db,
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
          db,
          settings,
          libraryScope,
          noteImport,
          noteIndex,
          metadataCache: plugin.app.metadataCache,
          template,
        }),
    })
    .use({
      citationIndex: ({ noteIndex, settings, db, libraryScope, queryClient }) =>
        new CitationIndex({
          app: plugin.app,
          noteIndex,
          settings,
          db,
          libraryScope,
          queryClient,
        }),
    })
    .use({
      pandocEngine: () => createPandocEngineService(plugin.app),
    })
    .use({
      bibliographyRender: ({
        db,
        pandocEngine,
        zoteroPref,
        settings,
        profile,
        queryClient,
      }) =>
        new BibliographyRenderCache({
          profile,
          db,
          pandocEngine,
          zoteroPref,
          settings,
          queryClient,
        }),
    })
    .use({
      citationText: ({
        profile,
        db,
        citationIndex,
        noteIndex,
        bibliographyRender,
        queryClient,
      }) =>
        new CitationText({
          profile,
          app: plugin.app,
          db,
          citationIndex,
          noteIndex,
          bibliographyRender,
          queryClient,
        }),
    })
    .use({
      citationPopover: ({
        profile,
        db,
        citationIndex,
        citationText,
        bibliographyRender,
        libraryScope,
      }): CitationPopover =>
        new CitationPopover({
          profile,
          app: plugin.app,
          db,
          citationIndex,
          citationText,
          bibliographyRender,
          libraryScope,
        }),
    })
    .use({
      citekeyEditor: ({
        noteIndex,
        noteFeature,
        createProfile,
        importProfile,
        zoteroPref,
        db,
        citationText,
        citationPopover,
        settings,
        citationIndex,
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
          db,
          citationText,
          citationPopover,
          settings,
          citationIndex,
          libraryScope,
        }),
    })
    .use({
      wikilinkEditor: ({
        noteIndex,
        citationText,
        citekeyEditor,
        citationPopover,
        settings,
        citationIndex,
      }) =>
        new WikilinkEditor({
          app: plugin.app,
          plugin,
          noteIndex,
          citationText,
          citekeyEditor,
          citationPopover,
          settings,
          citationIndex,
        }),
    })
    .use({
      wikilinkReading: ({
        noteIndex,
        citationText,
        citekeyEditor,
        citationPopover,
        settings,
        citationIndex,
      }) =>
        new WikilinkReading({
          app: plugin.app,
          plugin,
          noteIndex,
          citationText,
          citekeyEditor,
          citationPopover,
          settings,
          citationIndex,
        }),
    })
    .use({
      citekeyReading: ({
        citationText,
        citationIndex,
        citationPopover,
        citekeyEditor,
        settings,
      }) =>
        new CitekeyReading({
          app: plugin.app,
          plugin,
          citationText,
          citationIndex,
          citationPopover,
          citekeyEditor,
          settings,
        }),
    })
    .use({
      graphCitations: ({
        db,
        libraryScope,
        citationIndex,
        noteIndex,
        citekeyEditor,
        citationPopover,
        settings,
      }) =>
        new GraphCitations({
          app: plugin.app,
          db,
          libraryScope,
          citationIndex,
          noteIndex,
          citekeyEditor,
          citationPopover,
          settings,
        }),
    });
}
