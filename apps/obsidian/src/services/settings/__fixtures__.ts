import type { Plugin } from "obsidian";

import { Context, Effect, Layer } from "@/lib/effect";
import { effectBridge } from "@/lib/effect-bridge";
import type { EffectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import type { SubscriptionRuntime } from "@/lib/effect-stream";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/profile/bindings";

import { layerPluginSettings, PluginSettings } from "./service";
import type { PluginSettingsOptions, Settings } from "./service";

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

/**
 * The settings service, its bridge, and its runtime, using the test's Clock and
 * logger; all three close with the test Scope.
 */
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

export type SettingsFixture = PluginSettings["Service"] &
  AsyncDisposable & {
    readonly bridge: EffectBridge;
    readonly runtime: SubscriptionRuntime;
  };

/** Consumer fixtures outside Effect own the service's runtime through this handle. */
export async function buildSettings(
  options: SettingsFixtureOptions,
): Promise<SettingsFixture> {
  const { settings, bridge, close, runtime } = await openSettings(options);
  return Object.assign(settings, {
    bridge,
    runtime,
    [Symbol.asyncDispose]: close,
  });
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
  const settings = runtime.runSync(PluginSettings);
  const lifetime = stack.move();
  return {
    settings,
    bridge: effectBridge(runtime),
    runtime,
    close: () => lifetime.disposeAsync(),
  };
}

/** Values a test seeds: persisted settings, and default Profile bindings by name. */
export type SettingsOverrides = Partial<Settings> &
  Partial<ResolvedLiteratureNoteProfileBindings>;

const BINDING_KEYS = [
  "note.literature-folder",
  "citation.references-style",
  "note.import-folder",
  "note.import-colored-highlights",
  "note.import-annotations-as-template",
] as const satisfies readonly (keyof ResolvedLiteratureNoteProfileBindings)[];

/**
 * Writes `overrides` through the real store: settings through `update`, and a
 * binding name through the default Profile's bindings.
 */
export function applySettings(
  settings: Pick<
    PluginSettings["Service"],
    "update" | "updateDefaultLiteratureNoteProfileBindings"
  >,
  bridge: Pick<EffectBridge, "runSync">,
  overrides: SettingsOverrides,
): void {
  const persisted: Record<string, unknown> = { ...overrides };
  const bindings: Record<string, unknown> = {};
  for (const key of BINDING_KEYS) {
    if (!(key in persisted)) continue;
    bindings[key] = persisted[key];
    delete persisted[key];
  }
  if (Object.keys(persisted).length > 0)
    bridge.runSync(settings.update(persisted as Partial<Settings>));
  if (Object.keys(bindings).length > 0)
    bridge.runSync(
      settings.updateDefaultLiteratureNoteProfileBindings(
        bindings as Partial<ResolvedLiteratureNoteProfileBindings>,
      ),
    );
}

/** The real store over empty plugin data, seeded with `overrides`. */
export async function buildSeededSettings(overrides: SettingsOverrides = {}) {
  const settings = await buildSettings({
    plugin: {
      loadData: () => Promise.resolve(null),
      saveData: () => Promise.resolve(),
    },
  });
  applySettings(settings, settings.bridge, overrides);
  return settings;
}
