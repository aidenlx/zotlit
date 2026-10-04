import { Effect, Exit } from "effect";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryDatabase } from "@zotlit/db/item-query";
import type { ItemQueryDatabaseError } from "@zotlit/db/item-query";
import { ItemQueryScheduler, queryItems } from "@zotlit/item-query";
import type {
  ItemQueryError,
  ItemQueryRequest,
  QueryResult,
} from "@zotlit/item-query";

/**
 * Run one Item Query on the leased client to its `Exit`. Each run gets its own
 * time-budget scheduler; the Query Clock is the system clock and zone. The
 * caller holds the lease until the returned promise settles.
 *
 * Effect starts a run on a signal that is already aborted, so the abort check
 * comes first.
 */
export function runItemQuery(
  request: ItemQueryRequest,
  options: { client: NodeDatabaseClient; signal: AbortSignal },
): Promise<Exit.Exit<QueryResult, ItemQueryError | ItemQueryDatabaseError>> {
  if (options.signal.aborted) return Promise.resolve(Exit.interrupt());
  return Effect.runPromiseExit(
    Effect.provideService(queryItems(request), ItemQueryDatabase, {
      client: options.client,
    }),
    { scheduler: new ItemQueryScheduler(), signal: options.signal },
  );
}
