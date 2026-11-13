// A scoped, cloned protocol pair shared by the in-process RPC adapters.
import { Effect, Queue, Schema } from "effect";
import { RpcClient, RpcServer } from "effect/rpc";
import type { RpcMessage, RpcSerialization } from "effect/rpc";

/** The server-side id of the one client the in-process pair serves. */
const CLIENT_ID = 0;

/**
 * Wire both protocol ends together in memory. Every message passes through
 * `structuredClone` and the JSON codecs, as the Web Worker transport does, so a
 * value the codecs miss fails here the same way it would across the worker.
 */
export const makeInMemoryRpcProtocols = Effect.gen(function* () {
  // Each side writes into the other once it is built.
  let toServer: (
    message: RpcMessage.FromClientEncoded,
  ) => Effect.Effect<void> = () => Effect.void;
  let toClient: (
    message: RpcMessage.FromServerEncoded,
  ) => Effect.Effect<void> = () => Effect.void;
  // The client numbers itself; answers go back under that id.
  let clientSideId = 0;
  const codecFor = Schema.toCodecJson as RpcSerialization.CodecFor;
  const disconnects = yield* Queue.make<number>();

  const server = yield* RpcServer.Protocol.make((writeRequest) => {
    toServer = (message) => writeRequest(CLIENT_ID, message);
    return Effect.succeed({
      disconnects,
      send: (_clientId: number, response: RpcMessage.FromServerEncoded) =>
        Effect.suspend(() => toClient(structuredClone(response))),
      end: () => Effect.void,
      clientIds: Effect.succeed(new Set([CLIENT_ID])),
      initialMessage: Effect.succeedNone,
      supportsAck: true,
      supportsTransferables: false,
      supportsSpanPropagation: false,
      supportsNotifications: false,
      codecFor,
    });
  });

  const client = yield* RpcClient.Protocol.make((writeResponse) => {
    toClient = (message) => writeResponse(clientSideId, message);
    return Effect.succeed({
      send: (clientId: number, request: RpcMessage.FromClientEncoded) =>
        Effect.suspend(() => {
          clientSideId = clientId;
          return toServer(structuredClone(request));
        }),
      supportsAck: true,
      supportsTransferables: false,
      codecFor,
    });
  });

  return { server, client };
});
