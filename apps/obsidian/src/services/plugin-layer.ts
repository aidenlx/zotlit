// The plugin's services that live in the Effect Layer graph, converted or bridged.
import type { Plugin } from "obsidian";

import { Effect, Layer } from "@/lib/effect";
import { ObsidianApp } from "@/lib/obsidian-app";

import { layerChineseSegmenter } from "./chinese-segmenter/service";
import type { ChineseSegmenter } from "./chinese-segmenter/service";
import { layerCitationParse } from "./citation-parse/service";
import type { CitationParse } from "./citation-parse/service";
import { layerLogging, layerLogOutput } from "./log/service";
import { layerManagedBinaryPlatform } from "./managed-binary/service";
import { layerPandocEngine } from "./pandoc/service";
import type { PandocEngine } from "./pandoc/service";
import { layerQueryClients } from "./query-client/service";
import type { QueryClients } from "./query-client/service";
import { serviceLayer } from "./service-layer";
import { settingsMigrations } from "./settings/migrate";
import { PluginSettings, SettingsService } from "./settings/service";
import { layerUseLedger } from "./use-ledger/service";
import type { UseLedger } from "./use-ledger/service";

/**
 * The graph `buildServices` builds before the container over `plugin`:
 * converted services, and the legacy services bridged into it with
 * `serviceLayer`. Settings and logging build first, so every other service
 * logs from its first line and closes before them. Every service reads time
 * from the Effect Clock, which a test replaces.
 */
export function pluginLayer(
  plugin: Plugin,
): Layer.Layer<
  | PluginSettings
  | UseLedger
  | QueryClients
  | CitationParse
  | ChineseSegmenter
  | PandocEngine
> {
  return Layer.mergeAll(
    layerUseLedger,
    Layer.mergeAll(layerChineseSegmenter, layerPandocEngine).pipe(
      Layer.provide(layerManagedBinaryPlatform),
    ),
    layerCitationParse,
    layerQueryClients,
  ).pipe(
    Layer.provide(Layer.succeed(ObsidianApp, plugin.app)),
    Layer.provideMerge(
      layerLogging.pipe(Layer.provide(layerLogOutput(plugin))),
    ),
    Layer.provideMerge(layerSettings(plugin)),
  );
}

function layerSettings(plugin: Plugin): Layer.Layer<PluginSettings> {
  return serviceLayer(PluginSettings, {
    key: "settings",
    make: Effect.sync(
      () =>
        new SettingsService({
          plugin,
          ...settingsMigrations,
          handoff: plugin.app,
        }),
    ),
  });
}
