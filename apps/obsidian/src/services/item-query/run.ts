import { Effect, Exit } from "effect";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryDatabase } from "@zotlit/db/item-query";
import type {
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
import {
  describeItemQuery,
  ItemQueryScheduler,
  queryItems,
} from "@zotlit/item-query";
import type {
  ItemQueryError,
  ItemQueryRequest,
  ItemQuerySchema,
  QueryResult,
} from "@zotlit/item-query";

interface RunOptions {
  client: NodeDatabaseClient;
  signal: AbortSignal;
}

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
  options: RunOptions,
): Promise<
  Exit.Exit<
    QueryResult,
    ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError
  >
> {
  return run(queryItems(request), options);
}

/** Read the Item Query Schema of the leased source to its `Exit`, as {@link runItemQuery} does. */
export function runDescribeItemQuery(
  options: RunOptions,
): Promise<
  Exit.Exit<ItemQuerySchema, ItemQueryLayoutError | ItemQueryDatabaseError>
> {
  return run(describeItemQuery(), options);
}

function run<A, E>(
  operation: Effect.Effect<A, E, ItemQueryDatabase>,
  options: RunOptions,
): Promise<Exit.Exit<A, E>> {
  if (options.signal.aborted) return Promise.resolve(Exit.interrupt());
  return Effect.runPromiseExit(
    Effect.provideService(operation, ItemQueryDatabase, {
      client: options.client,
    }),
    { scheduler: new ItemQueryScheduler(), signal: options.signal },
  );
}
