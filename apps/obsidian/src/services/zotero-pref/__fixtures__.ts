import type { App } from "obsidian";

import { Context, Effect, Layer } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { ObsidianApp } from "@/lib/obsidian-app";

import { layerZoteroPref, ZoteroPref, ZoteroPrefFiles } from "./service";

/** The real preference layer over device storage and file-system fakes. */
export const zoteroPrefFixture = Effect.fn("zoteroPrefFixture")(function* (
  read: (path: string) => Effect.Effect<string, Error> = () => Effect.never,
  overrides: unknown = { profileDir: "/profile" },
) {
  let saved: unknown = overrides;
  const app = {
    loadLocalStorage: () => saved,
    saveLocalStorage: (_key: string, value: unknown) => {
      saved = value;
    },
  } as unknown as App;
  const layer = layerZoteroPref.pipe(
    Layer.provide(Layer.succeed(ObsidianApp, app)),
    Layer.provide(Layer.succeed(ZoteroPrefFiles, { read })),
  );
  const context = yield* Effect.context<never>();
  const { runtime } = yield* Effect.acquireRelease(
    Effect.sync(() =>
      scopedRuntime(
        layer.pipe(Layer.provideMerge(Layer.succeedContext(context))),
      ),
    ),
    (resource) => Effect.promise(resource.close),
  );
  const pref = Context.get(yield* runtime.contextEffect, ZoteroPref);
  return { pref, runtime, saved: () => saved };
});

/** The ordinary runtime boundary, owned by the fixture's Effect Scope. */
function scopedRuntime(layer: Layer.Layer<ZoteroPref>) {
  const stack = new AsyncDisposableStack();
  const runtime = buildRuntime(layer, stack);
  return { runtime, close: () => stack.disposeAsync() };
}
