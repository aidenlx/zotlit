// In-process adapter: the ZoteroReads handler layer on the calling runtime, over an in-memory protocol pair.
import { Effect, Option, Queue, Schema } from "effect";
import type { Scope } from "effect";
import { RpcClient, RpcServer } from "effect/rpc";
import type {
  RpcClientError,
  RpcGroup,
  RpcMessage,
  RpcSerialization,
} from "effect/rpc";

import type { Connection } from "./connection";
import { handlersLayer } from "./handlers";
import type { HandlersOptions } from "./handlers";
import { ZoteroReads } from "./rpc";

/** The client interface every ZoteroReads caller holds. */
export type ZoteroReadsClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof ZoteroReads>,
  RpcClientError.RpcClientError
>;

/** The server-side id of the one client the in-process pair serves. */
const CLIENT_ID = 0;

/**
 * Wire both protocol ends together in memory. Every message passes through
 * `structuredClone` and the JSON codecs, as the Web Worker transport does, so a
 * value the codecs miss fails here the same way it would across the worker.
 */
const makeProtocolPair = Effect.gen(function* () {
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
      initialMessage: Effect.succeed(Option.none()),
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

/**
 * Build a ZoteroReads client whose handlers run on this runtime against the
 * provided {@link Connection}. The server and client live for the caller's
 * scope.
 */
export function makeInProcessClient(
  options?: HandlersOptions,
): Effect.Effect<ZoteroReadsClient, never, Connection | Scope.Scope> {
  return Effect.gen(function* () {
    const protocols = yield* makeProtocolPair;
    yield* RpcServer.make(ZoteroReads).pipe(
      Effect.provide(handlersLayer(options)),
      Effect.provideService(RpcServer.Protocol, protocols.server),
      Effect.forkScoped,
    );
    return yield* RpcClient.make(ZoteroReads).pipe(
      Effect.provideService(RpcClient.Protocol, protocols.client),
    );
  });
}
