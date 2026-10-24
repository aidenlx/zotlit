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
export const settingsRuntimeOf = Effect.fnUntraced(function* (
  options: SettingsFixtureOptions,
) {
  const context = yield* Effect.context<never>();
  const handle = yield* Effect.acquireRelease(
    Effect.promise(() => openSettings(options, context)),
    (handle) => Effect.promise(handle.close),
  );
  return handle;
});

/** Consumer fixtures outside Effect own the adapter's runtime through this handle. */
export async function buildSettings(options: SettingsFixtureOptions): Promise<
  PlainPluginSettings &
    AsyncDisposable & {
      runtime: import("@/lib/effect-stream").SubscriptionRuntime;
    }
> {
  const { settings, close, runtime } = await openSettings(options);
  return Object.assign(settings, { runtime, [Symbol.asyncDispose]: close });
}

async function openSettings(
  { plugin, ...options }: SettingsFixtureOptions,
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const layer = layerPluginSettings(plugin, options).pipe(
    Layer.provideMerge(Layer.succeedContext(context)),
  );
  const runtime = buildRuntime(layer, stack);
  await runtime.context();
  const settings = Object.assign(plainPluginSettings(runtime), { runtime });
  const lifetime = stack.move();
  return { settings, runtime, close: () => lifetime.disposeAsync() };
}

export const plainSettingsOf = Effect.fnUntraced(function* (
  options: SettingsFixtureOptions,
) {
  return (yield* settingsRuntimeOf(options)).settings;
});
