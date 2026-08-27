import { openWelcomeView } from "@/views/welcome/register";
import type ZotLitPlugin from "@/zt-main";

import { AttachmentImportService } from "./attachment-import/service";
import { CitationIndex } from "./citation-index/service";
import { createCitationPopover } from "./citation-popover/service";
import type { CitationPopover } from "./citation-popover/service";
import { CitationText } from "./citation-text/service";
import { CitekeyEditor } from "./citekey-editor/service";
import { CitekeyReading } from "./citekey-reading/service";
import { DatabaseService } from "./database/service";
import { getChsSegmenter } from "./item-lookup/chs-segmenter";
import { ItemLookup } from "./item-lookup/service";
import { LibraryScopeService } from "./library-scope/service";
import { LiveUpdateService } from "./live-update/service";
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
} from "./settings/migrate";
import { SettingsService } from "./settings/service";
import {
  LiteratureNoteTemplateMigrationService,
  loadLiteratureNoteTemplateMigrationData,
} from "./template/migration";
import { LiteratureNotePackService } from "./template/pack";
import { TemplateService } from "./template/service";
import { WikilinkEditor } from "./wikilink-editor/service";
import { WikilinkReading } from "./wikilink-reading/service";
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
        }),
    })
    .use({
      log: ({ settings }) => new LoggingService({ plugin, settings }),
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
        new TemplateService({ plugin, app: plugin.app, settings }),
    })
    .use({
      templatePack: ({ settings, template }) =>
        new LiteratureNotePackService({
          app: plugin.app,
          settings,
          template,
        }),
    })
    .use({
      zoteroPref: () => new ZoteroPrefService({ app: plugin.app }),
    })
    .use({
      noteIndex: () => new NoteIndex({ plugin, app: plugin.app }),
    })
    .use({
      liveUpdate: ({ settings, zoteroPref, noteIndex }) =>
        new LiveUpdateService({ settings, zoteroPref, noteIndex }),
    })
    .use({
      db: ({ settings, zoteroPref }) =>
        new DatabaseService({ settings, zoteroPref }),
    })
    .use({
      attachmentImport: ({ settings, zoteroPref }) =>
        new AttachmentImportService({ app: plugin.app, settings, zoteroPref }),
    })
    .useValue({
      noteImport: ({
        noteIndex,
        template,
        zoteroPref,
        attachmentImport,
      }): NoteImporter =>
        createNoteImporter({
          app: plugin.app,
          noteIndex,
          template,
          zoteroPref,
          attachmentImport,
        }),
    })
    .use({
      libraryScope: ({ db, settings }) =>
        new LibraryScopeService({ db, settings }),
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
          loadVerificationData: () =>
            loadLiteratureNoteTemplateMigrationData({
              app: plugin.app,
              db,
              libraryScope,
              noteIndex,
              settings,
              templates: template,
              zoteroPref,
            }),
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
        template,
        db,
        noteIndex,
        zoteroPref,
        settings,
        attachmentImport,
        noteImport,
      }): NoteFeature =>
        createNoteFeature({
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
      batchImport: ({
        db,
        settings,
        libraryScope,
        noteImport,
        noteIndex,
        template,
      }): BatchImport =>
        createBatchImport({
          view: createNoteImportView(plugin.app),
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
      citationIndex: ({ noteIndex, settings, db, libraryScope }) =>
        new CitationIndex({
          app: plugin.app,
          noteIndex,
          settings,
          db,
          libraryScope,
        }),
    })
    .use({
      pandocEngine: () => createPandocEngineService(plugin.app),
    })
    .use({
      bibliographyRender: ({ db, pandocEngine, zoteroPref, settings }) =>
        new BibliographyRenderCache({
          db,
          pandocEngine,
          zoteroPref,
          settings,
        }),
    })
    .use({
      citationText: ({ db, citationIndex, noteIndex, bibliographyRender }) =>
        new CitationText({
          app: plugin.app,
          db,
          citationIndex,
          noteIndex,
          bibliographyRender,
        }),
    })
    .useValue({
      citationPopover: ({
        db,
        citationIndex,
        citationText,
        bibliographyRender,
        libraryScope,
      }): CitationPopover =>
        createCitationPopover({
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
    });
}
