// The worker side of a database worker's life: it serves the RPC server over
// the worker's global scope and answers the renderer's close message.
import * as BrowserWorkerRunner from "@effect/platform-browser/BrowserWorkerRunner";
import { Effect, Layer } from "effect";
import { RpcServer } from "effect/rpc";

import { WORKER_CLOSED } from "./worker-signal";

/** What the worker uses of its global scope. */
export interface WorkerScope {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  postMessage(message: unknown): void;
  close(): void;
}

/**
 * Serve `server` over `scope` until the renderer's close message. Then every
 * finalizer of `server` runs, the worker posts {@link WORKER_CLOSED}, and only
 * then does it close `scope`.
 */
export function launchWorker<E>(
  scope: WorkerScope,
  server: Layer.Layer<never, E, RpcServer.Protocol>,
): void {
  // The runner closes its endpoint as soon as the close message ends its run,
  // before the launch's finalizers run (Effect 4.0.0). A worker scope closed
  // there drops every task still queued: the finalizers never run and the
  // renderer waits out its close timeout. So the runner gets an endpoint
  // whose `close` does nothing, and the scope closes after the answer.
  const endpoint: WorkerScope = {
    addEventListener: scope.addEventListener.bind(scope),
    removeEventListener: scope.removeEventListener.bind(scope),
    postMessage: scope.postMessage.bind(scope),
    close: () => undefined,
  };
  const main = server.pipe(
    Layer.provide(
      RpcServer.layerProtocolWorkerRunner.pipe(
        Layer.provide(
          BrowserWorkerRunner.layerMessagePort(endpoint as MessagePort),
        ),
      ),
    ),
    Layer.launch,
    Effect.runFork,
  );
  main.addObserver(() => {
    scope.postMessage(WORKER_CLOSED);
    scope.close();
  });
}
