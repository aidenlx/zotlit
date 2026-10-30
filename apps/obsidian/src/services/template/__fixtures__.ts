import { Context, Effect, Layer } from "effect";
import type { App } from "obsidian";

import {
  createObsidianHost,
  PluginStub,
} from "@/lib/__fixtures__/obsidian-host";
import { layerHost, layerHostApp } from "@/lib/__fixtures__/obsidian-host-app";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { loadedTextFileView } from "@/lib/live-text";
import { ObsidianApp } from "@/lib/obsidian-app";
import { Workspace } from "@/lib/obsidian-workspace";
import {
  layerPluginSettings,
  PluginSettings,
} from "@/services/settings/service";

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
    __VERSION__: 11,
    "template.folder": "templates",
  });
  return { ...host, app, plugin, storage };
}

export function templateOver(host: ReturnType<typeof createTemplateHost>) {
  return layerTemplate.pipe(
    Layer.provide(layerHostApp(host.app)),
    Layer.provideMerge(layerPluginSettings(host.plugin)),
  );
}

export const templateOf = Effect.fnUntraced(function* (
  host: ReturnType<typeof createTemplateHost>,
) {
  return Context.get(yield* Layer.build(templateOver(host)), Template);
});

/** Reuse a consumer fixture's Settings service. */
export function templateSettings(settings: PluginSettings["Service"]) {
  return Layer.succeed(PluginSettings, settings);
}

export async function buildTemplate(
  options: { app: App; settings: PluginSettings["Service"] },
  context = Context.empty(),
) {
  await using stack = new AsyncDisposableStack();
  const runtime = buildRuntime(
    layerTemplate.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ObsidianApp, options.app),
          layerHost({
            vault: options.app.vault,
            fileManager: options.app.fileManager,
          }),
          Layer.mock(Workspace, {
            loadedTextView: (file) =>
              Effect.sync(() => loadedTextFileView(options.app, file)),
          }),
        ),
      ),
      Layer.provide(templateSettings(options.settings)),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  await runtime.context();
  const service = Object.assign(runtime.runSync(Template), {
    bridge: effectBridge(runtime),
    runtime,
    templateService: runtime.runSync(Template),
  });
  const lifetime = stack.move();
  return Object.assign(service, {
    [Symbol.asyncDispose]: () => lifetime.disposeAsync(),
  });
}
