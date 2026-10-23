// In-process adapter: the CitationParseRpc handler layer on the calling runtime, over an in-memory protocol pair.

import { RpcClient, RpcServer } from "effect/rpc";
import type { RpcClientError, RpcGroup } from "effect/rpc";

import { Effect } from "@/lib/effect";
import type { Scope } from "@/lib/effect";
import { makeInMemoryRpcProtocols } from "@/lib/effect-rpc-in-process";

import { decodeParseReply } from "./client";
import type { ParseClient } from "./client";
import { layerParseHandlers } from "./handlers";
import { CitationParseRpc } from "./rpc";
import { makeParseRpcClient } from "./rpc-client";

/** The client interface every CitationParseRpc caller holds. */
export type ParseRpcClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof CitationParseRpc>,
  RpcClientError.RpcClientError
>;

/**
 * Build a CitationParseRpc client whose handlers run on this runtime against the
 * scanner. The server and client live for the caller's
 * scope.
 */
export const makeInProcessClient = Effect.fnUntraced(
  function* (): Effect.fn.Return<ParseRpcClient, never, Scope.Scope> {
    const protocols = yield* makeInMemoryRpcProtocols;
    yield* RpcServer.make(CitationParseRpc, { disableTracing: true }).pipe(
      Effect.provide(layerParseHandlers),
      Effect.provideService(RpcServer.Protocol, protocols.server),
      Effect.forkScoped,
    );
    return yield* makeParseRpcClient().pipe(
      Effect.provideService(RpcClient.Protocol, protocols.client),
    );
  },
);

/** Plain fixture adapter; each call closes its server and client together. */
export const inProcessParseClient: ParseClient = {
  parse: (request, signal) =>
    Effect.runPromise(
      Effect.flatMap(makeInProcessClient(), (client) =>
        client.Parse(request).pipe(Effect.map(decodeParseReply)),
      ).pipe(Effect.scoped),
      { signal },
    ),
};
