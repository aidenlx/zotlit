// The real parse layer over a controllable Obsidian layout boundary.
import type { App } from "obsidian";

import { Layer } from "@/lib/effect";
import { buildRuntime } from "@/lib/effect-layer";
import { acquireAsyncDisposable } from "@/lib/effect-scope";
import { ObsidianApp } from "@/lib/obsidian-app";

import { plainCitationParse } from "./plain";
import { layerCitationParse } from "./service";

async function createParseHarness(ready: boolean) {
  await using stack = new AsyncDisposableStack();
  let layoutReady = () => {};
  const app = {
    workspace: {
      onLayoutReady: (callback: () => void) => {
        if (ready) callback();
        else layoutReady = callback;
      },
    },
  } as unknown as App;
  const runtime = buildRuntime(
    layerCitationParse.pipe(Layer.provide(Layer.succeed(ObsidianApp, app))),
    stack,
  );
  await runtime.context();
  const resources = stack.move();
  return {
    runtime,
    parser: plainCitationParse(runtime),
    layoutReady: () => layoutReady(),
    [Symbol.asyncDispose]: () => resources.disposeAsync(),
  };
}

export const makeParseHarness = (ready = false) =>
  acquireAsyncDisposable(() => createParseHarness(ready));
