import { Context, Effect, Layer } from "effect";
import type { App } from "obsidian";

import { buildRuntime } from "@/lib/effect-layer";
import { ObsidianApp } from "@/lib/obsidian-app";

import { layerZoteroPref, ZoteroPref, ZoteroPrefFiles } from "./service";

/** The real preference layer over device storage and file-system fakes. */
export const zoteroPrefFixture = Effect.fn("zoteroPrefFixture")(function* (
  read: (path: string) => Effect.Effect<string, Error> = () =>
    Effect.succeed(""),
  overrides: unknown = { profileDir: "/profile" },
  onSave: () => void = () => undefined,
) {
  let saved: unknown = overrides;
  const app = {
    loadLocalStorage: () => saved,
    saveLocalStorage: (_key: string, value: unknown) => {
      saved = value;
      onSave();
    },
  } as unknown as App;
  const layer = layerZoteroPref.pipe(
    Layer.provide(Layer.succeed(ObsidianApp, app)),
    Layer.provide(Layer.succeed(ZoteroPrefFiles, { read })),
  );
  const context = yield* Effect.context<never>();
  const { runtime } = yield* Effect.acquireRelease(
    Effect.promise(() =>
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
async function scopedRuntime(layer: Layer.Layer<ZoteroPref>) {
  const stack = new AsyncDisposableStack();
  const runtime = buildRuntime(layer, stack);
  await runtime.context();
  return { runtime, close: () => stack.disposeAsync() };
}
