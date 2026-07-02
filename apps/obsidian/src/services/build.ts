import type ZotLitPlugin from "@/zt-main";

import { AttachmentImportService } from "./attachment-import/service";
import { CitekeyClick } from "./citekey-click/service";
import { DatabaseService } from "./database/service";
import { getChsSegmenter } from "./item-lookup/chs-segmenter";
import { ItemLookup } from "./item-lookup/service";
import { LiveUpdateService } from "./live-update/service";
import { LoggingService } from "./log/service";
import { type NoteFeatureContext } from "./note-feature";
import { type NoteImportContext } from "./note-import/batch-import";
import { NoteImportService } from "./note-import/service";
import { NoteIndex } from "./note-index/service";
import { ServiceContainer } from "./service-base";
import { migrateLegacyV0 } from "./settings/migrate";
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
        new SettingsService({ plugin, migrateLegacy: migrateLegacyV0 }),
    })
    .use({
      log: ({ settings }) => new LoggingService({ plugin, settings }),
    })
    .use({
      template: ({ settings }) =>
        new TemplateService({ plugin, app: plugin.app, settings }),
    })
    .use({
      zoteroPref: ({ settings }) => new ZoteroPrefService({ settings }),
    })
    .use({
      liveUpdate: ({ settings, zoteroPref }) =>
        new LiveUpdateService({ settings, zoteroPref }),
    })
    .use({
      db: ({ settings, zoteroPref }) =>
        new DatabaseService({ settings, zoteroPref }),
    })
    .use({
      attachmentImport: ({ settings }) =>
        new AttachmentImportService({ app: plugin.app, settings }),
    })
    .use({
      noteIndex: () => new NoteIndex({ plugin, app: plugin.app }),
    })
    .use({
      noteImport: ({ noteIndex, template, zoteroPref, attachmentImport }) =>
        new NoteImportService({
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
      noteFeatures: ({
        template,
        db,
        noteIndex,
        zoteroPref,
        settings,
        attachmentImport,
        noteImport,
      }): NoteFeatureContext => ({
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
      noteImportCtx: ({
        db,
        settings,
        noteImport,
        noteIndex,
        noteFeatures,
      }): NoteImportContext => ({
        db,
        settings,
        noteImport,
        noteIndex,
        noteFeatures,
      }),
    })
    .use({
      citekeyClick: ({ noteIndex, noteFeatures, db, settings }) =>
        new CitekeyClick({
          app: plugin.app,
          noteIndex,
          noteFeatures,
          db,
          settings,
        }),
    });
}
