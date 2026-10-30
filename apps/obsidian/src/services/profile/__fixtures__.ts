import { Effect, Layer } from "effect";

import { layerHostApp } from "@/lib/__fixtures__/obsidian-host-app";
import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { layerNoteIndex } from "@/services/note-index/service";
import {
  layerPluginSettings,
  PluginSettings,
} from "@/services/settings/service";
import type { createTemplateHost } from "@/services/template/__fixtures__";
import { layerTemplate, Template } from "@/services/template/service";

import { layerProfile, Profile } from "./service";

/**
 * The real Profile dependency graph over the fake Obsidian host, with the
 * capability tags it reads.
 */
export function profileOver(host: ReturnType<typeof createTemplateHost>) {
  return layerProfile.pipe(
    Layer.provideMerge(Layer.mergeAll(layerTemplate, layerNoteIndex)),
    Layer.provideMerge(layerPluginSettings(host.plugin)),
    Layer.provideMerge(layerHostApp(host.app)),
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
    profile: Object.assign(runtime.runSync(Profile), {
      runtime,
      bridge: effectBridge(runtime),
    }),
    profileService: runtime.runSync(Profile),
    template: Object.assign(runtime.runSync(Template), {
      runtime,
      bridge: effectBridge(runtime),
    }),
    settings: runtime.runSync(PluginSettings),
    bridge: effectBridge(runtime),
  };
});
