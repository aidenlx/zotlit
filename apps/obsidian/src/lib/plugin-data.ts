// The plugin's `data.json`, as a service the Effect layers load and save through.
import type { Plugin } from "obsidian";

import { Context, Effect, Layer } from "@/lib/effect";
import type { Cause } from "@/lib/effect";

/** The plugin's saved data: `Plugin.loadData` and `Plugin.saveData`. */
export class PluginData extends Context.Service<
  PluginData,
  {
    /**
     * The saved data, `null` when there is none yet. A failure carries what
     * Obsidian threw as its `cause`.
     */
    readonly load: Effect.Effect<unknown, Cause.UnknownError>;
    save(data: unknown): Effect.Effect<void, Cause.UnknownError>;
  }
>()("zotlit/obsidian/PluginData") {}

export function layerPluginData(
  plugin: Pick<Plugin, "loadData" | "saveData">,
): Layer.Layer<PluginData> {
  return Layer.succeed(
    PluginData,
    PluginData.of({
      load: Effect.tryPromise((): Promise<unknown> => plugin.loadData()),
      save: (data) => Effect.tryPromise(() => plugin.saveData(data)),
    }),
  );
}
