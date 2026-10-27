// The real parse layer over a controllable Obsidian layout boundary.
import { Effect, Layer } from "effect";

import { MemoryWorkspace } from "@/lib/__fixtures__/obsidian-workspace";
import { buildRuntime } from "@/lib/effect-layer";
import { layerWorkspaceFrom } from "@/lib/obsidian-workspace";

import type { ParseRequest } from "./client";
import { CitationParse, layerCitationParse } from "./service";

function openParseHarness(ready: boolean) {
  const stack = new AsyncDisposableStack();
  const workspace = new MemoryWorkspace({ layoutReady: ready });
  const runtime = buildRuntime(
    layerCitationParse.pipe(Layer.provide(layerWorkspaceFrom(workspace))),
    stack,
  );
  return {
    runtime,
    parser: runtime.runSync(CitationParse),
    layoutReady: () => workspace.layoutReady(),
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

/** A caller owns its parse fiber and can interrupt it without stopping the worker. */
export const cancellableParse = Effect.fnUntraced(function* (
  parser: CitationParse["Service"],
  request: ParseRequest,
) {
  return yield* Effect.forkChild(parser.parse(request), {
    startImmediately: true,
  });
});
