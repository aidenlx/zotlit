import type { Plugin } from "obsidian";

import { Context, Effect, Layer } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import type { ResolvedLiteratureNoteProfileBindings } from "@/services/profile/bindings";

import { plainPluginSettings } from "./plain";
import type { PlainPluginSettings } from "./plain";
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
    PlainPluginSettings,
    "update" | "updateDefaultLiteratureNoteProfileBindings"
  >,
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
    settings.update(persisted as Partial<Settings>);
  if (Object.keys(bindings).length > 0)
    settings.updateDefaultLiteratureNoteProfileBindings(
      bindings as Partial<ResolvedLiteratureNoteProfileBindings>,
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
  applySettings(settings, overrides);
  return settings;
}
