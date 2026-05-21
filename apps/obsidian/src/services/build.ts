import type ZotLitPlugin from "@/zt-main";

import { DatabaseService } from "./database/service";
import { getChsSegmenter } from "./item-lookup/engine";
import { ItemLookup } from "./item-lookup/service";
import { LoggingService } from "./log/service";
import { NoteIndex } from "./note-index/service";
import { ServiceContainer } from "./service-base";
import { migrateLegacyV0 } from "./settings/migrate";
import { SettingsService } from "./settings/service";
import { TemplateService } from "./template/service";

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
      db: ({ settings }) => new DatabaseService({ settings }),
    })
    .use({
      noteIndex: () => new NoteIndex({ plugin, app: plugin.app }),
    })
    .use({
      itemLookup: ({ db, settings }) =>
        new ItemLookup({
          db,
          settings,
          getChsSegmenter: () => getChsSegmenter(plugin.app),
        }),
    });
}
