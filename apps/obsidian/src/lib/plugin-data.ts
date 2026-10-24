// The plugin's `data.json`, as a service the Effect layers load and save through.
import type { Plugin } from "obsidian";

import { Context, Effect, Layer, Schema } from "@/lib/effect";

/** `loadData` or `saveData` rejected; `cause` holds what Obsidian threw. */
export class PluginDataError extends Schema.TaggedError<PluginDataError>()(
  "PluginDataError",
  {
    operation: Schema.Literals(["load", "save"]),
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

const failure = (operation: "load" | "save") => (cause: unknown) =>
  new PluginDataError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/** The plugin's saved data: `Plugin.loadData` and `Plugin.saveData`. */
export class PluginData extends Context.Service<
  PluginData,
  {
    /** The saved data, `null` when there is none yet. */
    readonly load: Effect.Effect<unknown, PluginDataError>;
    save(data: unknown): Effect.Effect<void, PluginDataError>;
  }
>()("zotlit/obsidian/PluginData") {}

export function layerPluginData(
  plugin: Pick<Plugin, "loadData" | "saveData">,
): Layer.Layer<PluginData> {
  return Layer.succeed(
    PluginData,
    PluginData.of({
      load: Effect.tryPromise({
        try: (): Promise<unknown> => plugin.loadData(),
        catch: failure("load"),
      }),
      save: (data) =>
        Effect.tryPromise({
          try: () => plugin.saveData(data),
          catch: failure("save"),
        }),
    }),
  );
}
