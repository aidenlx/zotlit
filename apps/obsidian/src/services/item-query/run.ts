// Runs the two operations of `@zotlit/item-query` to an `Exit` on a leased
// client: the scheduler, the abort signal, and the database service of a run.
import { Effect, Exit } from "effect";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryDatabase, readTargetLibrary } from "@zotlit/db/item-query";
import type {
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
  TargetLibraryRow,
  TargetLibrarySelector,
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

/**
 * Wraps the operation of one run before it starts, to provide the observer
 * references of the engine. Only the dev-build measurement command passes one.
 */
export type ItemQueryInstrument = <A, E, R>(
  operation: Effect.Effect<A, E, R>,
) => Effect.Effect<A, E, R>;

interface RunOptions {
  client: NodeDatabaseClient;
  signal: AbortSignal;
  instrument?: ItemQueryInstrument;
}

/** The Library a run resolved and its result; no result without the Library. */
export type ItemQueryRun =
  | { readonly library: null }
  | { readonly library: TargetLibraryRow; readonly result: QueryResult };

/**
 * Resolve the Target Library and run one Item Query on the leased client to
 * its `Exit`. Each run gets its own time-budget scheduler; the Query Clock is
 * the system clock and zone. The caller holds the lease until the returned
 * promise settles.
 *
 * Effect starts a run on a signal that is already aborted, so the abort check
 * comes first.
 */
export function runItemQuery(
  selector: TargetLibrarySelector,
  request: Omit<ItemQueryRequest, "library">,
  options: RunOptions,
): Promise<
  Exit.Exit<
    ItemQueryRun,
    ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError
  >
> {
  return run(
    Effect.gen(function* () {
      const library = yield* readTargetLibrary(selector);
      if (library === null) return { library };
      const result = yield* queryItems({ ...request, library });
      return { library, result };
    }),
    options,
  );
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
    Effect.provideService(
      options.instrument?.(operation) ?? operation,
      ItemQueryDatabase,
      { client: options.client },
    ),
    { scheduler: new ItemQueryScheduler(), signal: options.signal },
  );
}
