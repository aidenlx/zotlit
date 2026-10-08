// Runs the operations of `@zotlit/item-query` to an `Exit` on a borrowed
// client: the scheduler, the abort signal, and the database service of a run.
import { Effect, Exit } from "effect";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryDatabase, readLibraries } from "@zotlit/db/item-query";
import type {
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
import {
  consumeQueryItems,
  describeItemQuery,
  ItemQueryScheduler,
  queryItems,
} from "@zotlit/item-query";
import type {
  ItemQueryError,
  ItemQueryRequest,
  ItemQuerySchema,
  QueryResult,
  QueryConsumer,
  QuerySummary,
} from "@zotlit/item-query";

import { resolveLibraryScope } from "@/services/library-scope/scope";
import type {
  LibraryScope,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";

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

/** The Libraries a run reads. */
export interface RunLibraries {
  /** The Library Scope in force, or the scope that the caller names. */
  readonly scope: LibraryScope;
  /** The run needs each Library of `scope`: the caller named them. */
  readonly requireEach: boolean;
}

export interface ItemQueryRun<A = QueryResult> {
  /**
   * `scope` on the Libraries of the borrowed source. The Target Libraries are
   * its available ones, in the canonical order.
   */
  readonly libraries: ResolvedLibraryScope;
  /**
   * `null`: the run read no Item, because the source has no Library of the
   * scope, or lacks one that the run needs.
   */
  readonly result: A | null;
}

/**
 * Resolve the Target Libraries and run one Item Query on the borrowed client to
 * its `Exit`. Each run gets its own time-budget scheduler; the Query Clock is
 * the system clock and zone. The caller owns the connection scope until the returned
 * promise settles.
 *
 * Effect starts a run on a signal that is already aborted, so the abort check
 * comes first.
 */
export function runItemQuery(
  { scope, requireEach }: RunLibraries,
  request: Omit<ItemQueryRequest, "libraries">,
  options: RunOptions,
): Promise<
  Exit.Exit<
    ItemQueryRun,
    ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError
  >
> {
  return runItemQueryWith({ scope, requireEach }, request, {
    ...options,
    execute: (request) => queryItems(request),
  });
}

/** Consume projection chunks under the same scope, scheduler, and connection borrow. */
export function runItemQueryTo<A, E>(
  libraries: RunLibraries,
  request: Omit<ItemQueryRequest, "libraries">,
  options: RunOptions & {
    begin: (
      summary: QuerySummary,
      libraries: ResolvedLibraryScope,
    ) => Effect.Effect<QueryConsumer<A, E>, E>;
  },
): Promise<
  Exit.Exit<
    ItemQueryRun<A>,
    ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError | E
  >
> {
  return runItemQueryWith(libraries, request, {
    ...options,
    execute: (request, libraries) =>
      consumeQueryItems(request, (summary) =>
        options.begin(summary, libraries),
      ),
  });
}

function runItemQueryWith<A, E>(
  { scope, requireEach }: RunLibraries,
  request: Omit<ItemQueryRequest, "libraries">,
  options: RunOptions & {
    execute: (
      request: ItemQueryRequest,
      libraries: ResolvedLibraryScope,
    ) => Effect.Effect<A, E, ItemQueryDatabase>;
  },
): Promise<
  Exit.Exit<ItemQueryRun<A>, E | ItemQueryLayoutError | ItemQueryDatabaseError>
> {
  return run(
    Effect.gen(function* () {
      // The resolution of the Library Scope service, on the rows of the one
      // Library reader of `getLibraries`, read on the borrowed client.
      const libraries = resolveLibraryScope(yield* readLibraries(), scope);
      const { available, unavailable } = libraries;
      if (available.length === 0 || (requireEach && unavailable.length > 0)) {
        return { libraries, result: null };
      }
      const result = yield* options.execute(
        {
          ...request,
          libraries: available.map(({ libraryID, selector }) => ({
            libraryID,
            groupID: selector.type === "group" ? selector.groupID : null,
          })),
        },
        libraries,
      );
      return { libraries, result };
    }),
    options,
  );
}

/** Read the Item Query Schema of the borrowed source to its `Exit`, as {@link runItemQuery} does. */
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
