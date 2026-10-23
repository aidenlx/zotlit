// The plugin's services that live in the Effect Layer graph, converted or bridged.
import type { Plugin } from "obsidian";

import { Clock, Effect, Layer } from "@/lib/effect";
import { instantClock } from "@/lib/effect-clock";
import { ObsidianApp } from "@/lib/obsidian-app";

import { layerCitationParse } from "./citation-parse/service";
import type { CitationParse } from "./citation-parse/service";
import { layerLogging, layerLogOutput } from "./log/service";
import { QueryClients, QueryClientService } from "./query-client/service";
import { serviceLayer } from "./service-layer";
import { layerPluginSettings } from "./settings/service";
import type { PluginSettings } from "./settings/service";
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
): Layer.Layer<PluginSettings | UseLedger | QueryClients | CitationParse> {
  return Layer.mergeAll(
    layerUseLedger,
    layerCitationParse,
    serviceLayer(QueryClients, {
      key: "queryClient",
      make: Effect.map(
        Clock.Clock,
        (clock) => new QueryClientService({ now: instantClock(clock) }),
      ),
    }),
  ).pipe(
    Layer.provide(Layer.succeed(ObsidianApp, plugin.app)),
    Layer.provideMerge(
      layerLogging.pipe(Layer.provide(layerLogOutput(plugin))),
    ),
    Layer.provideMerge(layerPluginSettings(plugin)),
  );
}
