// A scoped RPC client on a browser Worker or MessagePort.
import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import { RpcClient, RpcClientError } from "effect/rpc";
import type { RpcMessage, RpcSerialization } from "effect/rpc";
import { Worker } from "effect/workers";

import { Cause, Context, Effect, Layer, Schema } from "@/lib/effect";

import { makeParseRpcClient } from "./rpc-client";

// This connection owns one stateless worker. The recovery layer replaces the
// entire connection on death, so requests need neither a pool lease nor a
// second retry loop. RPC still owns request IDs, replies and interruption.
const singleWorkerProtocol = RpcClient.Protocol.make(
  Effect.fnUntraced(function* (writeResponse, clientIds) {
    const platform = yield* Worker.WorkerPlatform;
    const worker = yield* platform.spawn<
      RpcMessage.FromServerEncoded,
      RpcMessage.FromClientEncoded
    >(0);
    // This protocol is private to the one RpcClient constructed below.
    const receive = (response: RpcMessage.FromServerEncoded) => {
      const id = clientIds.values().next().value;
      return id === undefined ? Effect.void : writeResponse(id, response);
    };
    yield* worker.run(receive).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : receive({
              _tag: "ClientProtocolError",
              error: new RpcClientError.RpcClientError({
                reason: new RpcClientError.RpcClientDefect({
                  message: "Parse worker protocol failed",
                  cause: Cause.squash(cause),
                }),
              }),
            }),
      ),
      Effect.forkScoped,
    );
    return {
      send: (_clientId: number, request: RpcMessage.FromClientEncoded) =>
        worker
          .send(request)
          .pipe(
            Effect.mapError(
              (error) =>
                new RpcClientError.RpcClientError({ reason: error.reason }),
            ),
          ),
      supportsAck: true,
      // Parse carries strings and numbers; no request transfers an owned object.
      supportsTransferables: false,
      codecFor: Schema.toCodecJson as RpcSerialization.CodecFor,
    };
  }),
);

export const makeParseWorkerClient = Effect.fnUntraced(function* (
  spawn: () => Worker | MessagePort,
  measureEncoding?: () => () => void,
) {
  const protocol = yield* Layer.build(
    Layer.effect(RpcClient.Protocol, singleWorkerProtocol).pipe(
      Layer.provide(BrowserWorker.layer(spawn)),
    ),
  );
  const transport = Context.get(protocol, RpcClient.Protocol);
  return yield* makeParseRpcClient(measureEncoding).pipe(
    Effect.provideService(RpcClient.Protocol, transport),
  );
});
