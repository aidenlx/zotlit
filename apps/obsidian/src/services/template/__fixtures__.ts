import type { App } from "obsidian";

import {
  createObsidianHost,
  PluginStub,
} from "@/lib/__fixtures__/obsidian-host";
import { Context, Effect, Layer, Queue, Stream } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { ObsidianApp } from "@/lib/obsidian-app";
import type { PlainPluginSettings } from "@/services/settings/plain";
import {
  layerPluginSettings,
  PluginSettings,
} from "@/services/settings/service";

import { plainTemplate } from "./plain";
import { layerTemplate, Template } from "./service";

export function createTemplateHost(files: Record<string, string> = {}) {
  const host = createObsidianHost(files);
  const storage = new Map<string, unknown>();
  const app = {
    ...host.app,
    loadLocalStorage: (key: string) => storage.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => storage.set(key, value),
    fileManager: {
      trashFile: async (file: { path: string }) =>
        host.vault.deleteFile(file.path),
    },
  } as unknown as App;
  const plugin = new PluginStub(app, {
    __VERSION__: 10,
    "template.folder": "templates",
  });
  return { ...host, app, plugin, storage };
}

export function templateOver(host: ReturnType<typeof createTemplateHost>) {
  return layerTemplate.pipe(
    Layer.provide(Layer.succeed(ObsidianApp, host.app)),
    Layer.provideMerge(layerPluginSettings(host.plugin)),
  );
}

export const templateOf = Effect.fnUntraced(function* (
  host: ReturnType<typeof createTemplateHost>,
) {
  return Context.get(yield* Layer.build(templateOver(host)), Template);
});

/** Reuse a consumer fixture's real Settings runtime through its plain boundary. */
export function templateSettings(settings: PlainPluginSettings) {
  return Layer.succeed(
    PluginSettings,
    PluginSettings.of({
      current: Effect.sync(() => settings.current),
      loaded: Effect.promise(() => settings.loaded),
      diagnostics: Effect.sync(() => settings.diagnostics),
      hydrationOrigin: Effect.sync(() => settings.hydrationOrigin),
      update: (patch) => Effect.sync(() => settings.update(patch)),
      reset: (keys) => Effect.sync(() => settings.reset(keys)),
      updateDefaultLiteratureNoteProfileBindings: (patch) =>
        Effect.sync(() =>
          settings.updateDefaultLiteratureNoteProfileBindings(patch),
        ),
      flush: () => Effect.promise(() => settings.flush()),
      release: () => Effect.sync(() => settings.release()),
      changes: Stream.callback<
        Readonly<import("@/services/settings/schema").Settings>
      >((queue) =>
        Effect.acquireRelease(
          Effect.sync(() =>
            settings.subscribe((value) => Queue.offerUnsafe(queue, value)),
          ),
          (unsubscribe) => Effect.sync(unsubscribe),
        ),
      ),
    }),
  );
}

export async function buildTemplate(
  options: { app: App; settings: PlainPluginSettings },
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    layerTemplate.pipe(
      Layer.provide(Layer.succeed(ObsidianApp, options.app)),
      Layer.provide(templateSettings(options.settings)),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const service = plainTemplate(runtime);
  const lifetime = stack.move();
  return Object.assign(service, {
    [Symbol.asyncDispose]: () => lifetime.disposeAsync(),
  });
}
