// The real parse layer over a controllable Obsidian layout boundary.
import type { App } from "obsidian";

import { Effect, Layer } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { ObsidianApp } from "@/lib/obsidian-app";

import { plainCitationParse } from "./plain";
import { layerCitationParse } from "./service";

function openParseHarness(ready: boolean) {
  const stack = new AsyncDisposableStack();
  const deferred = {
    callback: () => {},
  };
  const app = {
    workspace: {
      onLayoutReady: (callback: () => void) => {
        if (ready) callback();
        else deferred.callback = callback;
      },
    },
  } as unknown as App;
  const runtime = buildRuntime(
    layerCitationParse.pipe(Layer.provide(Layer.succeed(ObsidianApp, app))),
    stack,
  );
  return {
    runtime,
    parser: plainCitationParse(runtime),
    layoutReady: () => deferred.callback(),
    context: () => runtime.context(),
    resources: stack.move(),
  };
}

export const makeParseHarness = Effect.fnUntraced(function* (ready = false) {
  const harness = openParseHarness(ready);
  // boundary: ManagedRuntime exposes layer acquisition as a Promise.
  yield* Effect.tryPromise(() => harness.context());
  return yield* Effect.acquireRelease(
    Effect.succeed({
      runtime: harness.runtime,
      parser: harness.parser,
      layoutReady: harness.layoutReady,
    }),
    // boundary: the test owns a runtime through AsyncDisposableStack.
    () => Effect.promise(() => harness.resources.disposeAsync()),
  );
});
