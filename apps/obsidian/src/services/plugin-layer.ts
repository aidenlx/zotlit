// The plugin's services that live in the Effect Layer graph, converted or bridged.
import type { Plugin } from "obsidian";

import { Layer } from "@/lib/effect";
import { ObsidianApp } from "@/lib/obsidian-app";

import { layerCitationParse } from "./citation-parse/service";
import type { CitationParse } from "./citation-parse/service";
import { layerLogging, layerLogOutput } from "./log/service";
import { layerQueryClients } from "./query-client/service";
import type { QueryClients } from "./query-client/service";
import { layerPluginSettings } from "./settings/service";
import type { PluginSettings } from "./settings/service";
import { layerUseLedger } from "./use-ledger/service";
import type { UseLedger } from "./use-ledger/service";
import { layerZoteroPref, layerZoteroPrefFiles } from "./zotero-pref/service";
import type { ZoteroPref } from "./zotero-pref/service";

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
  PluginSettings | UseLedger | QueryClients | CitationParse | ZoteroPref
> {
  return Layer.mergeAll(
    layerUseLedger,
    layerZoteroPref.pipe(Layer.provide(layerZoteroPrefFiles)),
    layerCitationParse,
    layerQueryClients,
  ).pipe(
    Layer.provide(Layer.succeed(ObsidianApp, plugin.app)),
    Layer.provideMerge(
      layerLogging.pipe(Layer.provide(layerLogOutput(plugin))),
    ),
    Layer.provideMerge(layerPluginSettings(plugin)),
  );
}
