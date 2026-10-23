// A scoped RPC client on a browser Worker or MessagePort.
import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import { RpcClient } from "effect/rpc";

import { Effect, Layer } from "@/lib/effect";

import { CitationParseRpc } from "./rpc";

export const makeParseWorkerClient = Effect.fnUntraced(function* (
  spawn: () => Worker | MessagePort,
) {
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolWorker({ size: 1, concurrency: 1024 }).pipe(
      Layer.provide(BrowserWorker.layer(spawn)),
    ),
  );
  // The service call carries the trace; per-note transport spans add backfill cost.
  return yield* RpcClient.make(CitationParseRpc, { disableTracing: true }).pipe(
    Effect.provideContext(protocol),
  );
});
