import { Effect, Layer } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { ObsidianApp } from "@/lib/obsidian-app";
import { layerNoteIndex } from "@/services/note-index/service";
import { plainPluginSettings } from "@/services/settings/plain";
import { layerPluginSettings } from "@/services/settings/service";
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
    Layer.provide(Layer.succeed(ObsidianApp, host.app)),
  );
}

export const profileRuntimeOf = Effect.fnUntraced(function* (
  host: ReturnType<typeof createTemplateHost>,
) {
  const stack = yield* acquireAsyncDisposable(
    async () => new AsyncDisposableStack(),
  );
  const context = yield* Effect.context<never>();
  const runtime = buildRuntime(
    profileOver(host).pipe(Layer.provideMerge(Layer.succeedContext(context))),
    stack,
  );
  yield* Effect.promise(() => runtime.context());
  return {
    runtime,
    profile: plainProfile(runtime),
    template: plainTemplate(runtime),
    settings: plainPluginSettings(runtime),
  };
});
