// Legacy Promise test harnesses exercise the real display layer through this edge.
import { Effect, Layer } from "effect";

import { effectBridge } from "@/lib/effect-bridge";
import { buildRuntime } from "@/lib/effect-layer";
import { QueryClients } from "@/services/query-client/service";

import { ExcerptDisplays, layerExcerptDisplays } from "@/services/excerpt-image/display";
import type { ExcerptRequest } from "@/services/excerpt-image/contract";
import { ExcerptImageService } from "@/services/excerpt-image/service";
import type { AvailableExcerpt, ExcerptOutcome } from "@/services/excerpt-image/service";

export class ExcerptDisplayFixture implements AsyncDisposable {
  readonly #stack = new AsyncDisposableStack();
  readonly #bridge;
  readonly service;
  readonly ready = Promise.resolve();

  constructor(deps: {
    queries: Pick<QueryClients["Service"], "client" | "invalidate" | "peek" | "read" | "watch">;
    resolve: (request: ExcerptRequest, signal?: AbortSignal) => Promise<ExcerptOutcome>;
    stored: (request: ExcerptRequest) => Promise<AvailableExcerpt | null>;
  }) {
    const runtime = buildRuntime(layerExcerptDisplays.pipe(Layer.provide(Layer.mergeAll(
      Layer.mock(QueryClients, deps.queries),
      Layer.mock(ExcerptImageService, {
        rendererDiagnostics: undefined,
        queueDiagnostics: { admitted: 0, rendering: 0, queued: 0, checking: 0, awaiting: 0 },
        resolve: (request) => Effect.tryPromise((signal) => deps.resolve(request, signal)),
        stored: (request) => Effect.promise(() => deps.stored(request)),
      }),
    ))), this.#stack);
    this.#bridge = effectBridge(runtime);
    this.service = runtime.runSync(ExcerptDisplays);
  }
  open() { return this.#bridge.runSync(this.service.open); }
  clear() { this.#bridge.runAndForget(this.service.clear); }
  refresh() { this.#bridge.runAndForget(this.service.refresh); }
  revalidate(request: ExcerptRequest) { this.#bridge.runAndForget(this.service.revalidate(request)); }
  [Symbol.asyncDispose]() { return this.#stack.disposeAsync(); }
}
