// In-process adapter: the CitationParseRpc handler layer on the calling runtime, over an in-memory protocol pair.

import { RpcClient, RpcServer } from "effect/rpc";
import type {
  RpcClientError,
  RpcGroup,
  RpcMessage,
  RpcSerialization,
} from "effect/rpc";

import { Effect, Option, Queue, Schema } from "@/lib/effect";
import type { Scope } from "@/lib/effect";

import type { ParseClient } from "./client";
import { layerParseHandlers } from "./handlers";
import { CitationParseRpc } from "./rpc";

/** The client interface every CitationParseRpc caller holds. */
export type ParseRpcClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof CitationParseRpc>,
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
 * Build a CitationParseRpc client whose handlers run on this runtime against the
 * scanner. The server and client live for the caller's
 * scope.
 */
export const makeInProcessClient = Effect.fnUntraced(
  function* (): Effect.fn.Return<ParseRpcClient, never, Scope.Scope> {
    const protocols = yield* makeProtocolPair;
    yield* RpcServer.make(CitationParseRpc, { disableTracing: true }).pipe(
      Effect.provide(layerParseHandlers),
      Effect.provideService(RpcServer.Protocol, protocols.server),
      Effect.forkScoped,
    );
    return yield* RpcClient.make(CitationParseRpc, {
      disableTracing: true,
    }).pipe(Effect.provideService(RpcClient.Protocol, protocols.client));
  },
);

/** Plain fixture adapter; each call closes its server and client together. */
export const inProcessParseClient: ParseClient = {
  parse: (request, signal) =>
    Effect.runPromise(
      Effect.flatMap(makeInProcessClient(), (client) =>
        client.Parse(request),
      ).pipe(Effect.scoped),
      { signal },
    ),
};
