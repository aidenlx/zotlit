import { openWelcomeView } from "@/views/welcome/register";
import type ZotLitPlugin from "@/zt-main";

import { AttachmentImportService } from "./attachment-import/service";
import { CitekeyClick } from "./citekey-click/service";
import { DatabaseService } from "./database/service";
import { getChsSegmenter } from "./item-lookup/chs-segmenter";
import { ItemLookup } from "./item-lookup/service";
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
import { ReleaseService } from "./release/service";
import { ServiceContainer } from "./service-base";
import {
  migrateLegacyV0,
  migrateV1ToV2,
  migrateV2ToV3,
} from "./settings/migrate";
import { SettingsService } from "./settings/service";
import { TemplateService } from "./template/service";
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
      zoteroPref: () => new ZoteroPrefService({ app: plugin.app }),
    })
    .use({
      noteIndex: ({ settings }) =>
        new NoteIndex({ plugin, app: plugin.app, settings }),
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
      itemLookup: ({ db, settings }) =>
        new ItemLookup({
          db,
          settings,
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
        noteImport,
        noteIndex,
        template,
      }): BatchImport =>
        createBatchImport({
          view: createNoteImportView(plugin.app),
          db,
          settings,
          noteImport,
          noteIndex,
          metadataCache: plugin.app.metadataCache,
          template,
        }),
    })
    .use({
      citekeyClick: ({ noteIndex, noteFeature, db, settings }) =>
        new CitekeyClick({
          app: plugin.app,
          noteIndex,
          noteFeature,
          db,
          settings,
        }),
    });
}
