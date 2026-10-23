// A scoped RPC client on a browser Worker or MessagePort.
import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import { RpcClient } from "effect/rpc";

import { Context, Effect, Layer, Schema } from "@/lib/effect";

import { CitationParseRpc } from "./rpc";

export const makeParseWorkerClient = Effect.fnUntraced(function* (
  spawn: () => Worker | MessagePort,
  measureEncoding?: () => () => void,
) {
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolWorker({ size: 1, concurrency: 1024 }).pipe(
      Layer.provide(BrowserWorker.layer(spawn)),
    ),
  );
  const transport = Context.get(protocol, RpcClient.Protocol);
  // The benchmark times codec work where the send fiber actually runs it.
  // Production uses the original codec without an observer or timing overhead.
  const measured = measureEncoding
    ? {
        ...transport,
        codecFor: <S extends Schema.Top>(schema: S) =>
          transport.codecFor(schema).pipe(
            Schema.middlewareEncoding((encode) =>
              Effect.suspend(() => {
                const end = measureEncoding();
                return encode.pipe(Effect.tap(() => Effect.sync(end)));
              }),
            ),
          ),
      }
    : transport;
  // The service call carries the trace; per-note transport spans add backfill cost.
  return yield* RpcClient.make(CitationParseRpc, { disableTracing: true }).pipe(
    Effect.provideService(RpcClient.Protocol, measured),
  );
});
