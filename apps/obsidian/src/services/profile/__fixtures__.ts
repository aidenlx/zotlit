import { layerHostApp } from "@/lib/__fixtures__/obsidian-host-app";
import { Effect, Layer } from "@/lib/effect";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { layerNoteIndex } from "@/services/note-index/service";
import {
  layerPluginSettings,
  PluginSettings,
} from "@/services/settings/service";
import type { createTemplateHost } from "@/services/template/__fixtures__";
import { plainTemplate } from "@/services/template/plain";
import { layerTemplate } from "@/services/template/service";

import { plainProfile } from "./plain";
import { layerProfile } from "./service";

/** The real Profile dependency graph over the fake Obsidian host. */
export function profileOver(host: ReturnType<typeof createTemplateHost>) {
  return layerProfile.pipe(
    Layer.provideMerge(Layer.mergeAll(layerTemplate, layerNoteIndex)),
    Layer.provideMerge(layerPluginSettings(host.plugin)),
    Layer.provide(layerHostApp(host.app)),
  );
}

export const profileRuntimeOf = Effect.fnUntraced(function* (
  host: ReturnType<typeof createTemplateHost>,
) {
  const stack = yield* Effect.acquireDisposable(
    Effect.tryPromise(async () => new AsyncDisposableStack()),
  );
  const context = yield* Effect.context<never>();
  const runtime = buildRuntime(
    profileOver(host).pipe(Layer.provideMerge(Layer.succeedContext(context))),
    stack,
  );
  yield* Effect.promise(() => runtime.context());
  return {
    runtime,
    profile: Object.assign(plainProfile(runtime), { runtime }),
    template: plainTemplate(runtime),
    settings: runtime.runSync(PluginSettings),
    bridge: effectBridge(runtime),
  };
});
