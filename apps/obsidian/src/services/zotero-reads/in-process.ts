import { RpcClient, RpcServer } from "effect/rpc";
import type { RpcClientError, RpcGroup } from "effect/rpc";

// In-process adapter: the ZoteroReads handler layer on the calling runtime, over an in-memory protocol pair.
import { Effect } from "@/lib/effect";
import type { Scope } from "@/lib/effect";
import { makeInMemoryRpcProtocols } from "@/lib/effect-rpc-in-process";

import type { Connection } from "./connection";
import { handlersLayer } from "./handlers";
import type { HandlersOptions } from "./handlers";
import { ZoteroReads } from "./rpc";

/** The client interface every ZoteroReads caller holds. */
export type ZoteroReadsClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof ZoteroReads>,
  RpcClientError.RpcClientError
>;

/**
 * Build a ZoteroReads client whose handlers run on this runtime against the
 * provided {@link Connection}. The server and client live for the caller's
 * scope.
 */
export const makeInProcessClient = Effect.fnUntraced(function* (
  options?: HandlersOptions,
): Effect.fn.Return<ZoteroReadsClient, never, Connection | Scope.Scope> {
  const protocols = yield* makeInMemoryRpcProtocols;
  yield* RpcServer.make(ZoteroReads).pipe(
    Effect.provide(handlersLayer(options)),
    Effect.provideService(RpcServer.Protocol, protocols.server),
    Effect.forkScoped,
  );
  return yield* RpcClient.make(ZoteroReads).pipe(
    Effect.provideService(RpcClient.Protocol, protocols.client),
  );
});
