import type { Plugin } from "obsidian";

import { Context, Effect, Layer } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";

import { plainPluginSettings } from "./plain";
import type { PlainPluginSettings } from "./plain";
import { layerPluginSettings, PluginSettings } from "./service";
import type { PluginSettingsOptions } from "./service";

export type SettingsFixtureOptions = Partial<PluginSettingsOptions> & {
  plugin: Pick<Plugin, "loadData" | "saveData">;
};

export const settingsOf = Effect.fnUntraced(function* ({
  plugin,
  ...options
}: SettingsFixtureOptions) {
  return Context.get(
    yield* Layer.build(layerPluginSettings(plugin, options)),
    PluginSettings,
  );
});

/** A plain adapter with the test's Clock and logger; its runtime closes with the test Scope. */
export const plainSettingsOf = Effect.fnUntraced(function* (
  options: SettingsFixtureOptions,
) {
  const context = yield* Effect.context<never>();
  const handle = yield* Effect.acquireRelease(
    Effect.sync(() => openSettings(options, context)),
    (handle) => Effect.promise(handle.close),
  );
  return handle.settings;
});

/** Consumer fixtures outside Effect own the adapter's runtime through this handle. */
export function buildSettings(
  options: SettingsFixtureOptions,
): PlainPluginSettings & AsyncDisposable {
  const { settings, close } = openSettings(options);
  return Object.assign(settings, { [Symbol.asyncDispose]: close });
}

function openSettings(
  { plugin, ...options }: SettingsFixtureOptions,
  context = Context.empty(),
) {
  const stack = new AsyncDisposableStack();
  const layer = layerPluginSettings(plugin, options).pipe(
    Layer.provideMerge(Layer.succeedContext(context)),
  );
  const settings = plainPluginSettings(buildRuntime(layer, stack));
  return { settings, close: () => stack.disposeAsync() };
}
