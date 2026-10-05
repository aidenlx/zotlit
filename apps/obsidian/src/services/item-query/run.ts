// Runs the two operations of `@zotlit/item-query` to an `Exit` on a leased
// client: the scheduler, the abort signal, and the database service of a run.
import { Effect, Exit } from "effect";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryDatabase, readTargetLibraries } from "@zotlit/db/item-query";
import type {
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
  TargetLibraryRow,
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

import { selectorKey } from "@/services/library-scope/scope";
import type {
  LibraryScope,
  LibrarySelector,
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

/** How a run chooses its Target Libraries among the Libraries of the source. */
export type LibrarySelection =
  /** The available Libraries of the Library Scope. */
  | { readonly from: "scope"; readonly scope: LibraryScope }
  /** Every Library of the source. */
  | { readonly from: "all" }
  /** The Libraries the caller names; each one must be in the source. */
  | { readonly from: "named"; readonly selectors: readonly LibrarySelector[] };

/**
 * The Target Libraries a run resolved, in the canonical order, and its result;
 * no result without a Library.
 */
export type ItemQueryRun =
  | {
      readonly outcome: "result";
      readonly libraries: readonly TargetLibraryRow[];
      readonly result: QueryResult;
    }
  /** The source has no Library for a selector the caller named. */
  | {
      readonly outcome: "library-not-found";
      readonly selector: LibrarySelector;
    }
  /** The source has no Library of the Library Scope. */
  | { readonly outcome: "no-library-available" };

function selectorOf(library: TargetLibraryRow): LibrarySelector {
  return library.groupID === null
    ? { type: "personal" }
    : { type: "group", groupID: library.groupID };
}

/**
 * Resolve the Target Libraries and run one Item Query on the leased client to
 * its `Exit`. Each run gets its own time-budget scheduler; the Query Clock is
 * the system clock and zone. The caller holds the lease until the returned
 * promise settles.
 *
 * Effect starts a run on a signal that is already aborted, so the abort check
 * comes first.
 */
export function runItemQuery(
  selection: LibrarySelection,
  request: Omit<ItemQueryRequest, "libraries">,
  options: RunOptions,
): Promise<
  Exit.Exit<
    ItemQueryRun,
    ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError
  >
> {
  return run(
    Effect.gen(function* () {
      // The Libraries of the source, in the canonical order.
      const source = yield* readTargetLibraries();
      let libraries = source;
      if (selection.from !== "all") {
        const selectors =
          selection.from === "named"
            ? selection.selectors
            : selection.scope.mode === "selected"
              ? selection.scope.libraries
              : source.map(selectorOf);
        const named = new Set(selectors.map(selectorKey));
        libraries = source.filter((library) =>
          named.has(selectorKey(selectorOf(library))),
        );
        if (selection.from === "named" && libraries.length < named.size) {
          const held = new Set(
            libraries.map((library) => selectorKey(selectorOf(library))),
          );
          const selector = selectors.find(
            (entry) => !held.has(selectorKey(entry)),
          )!;
          return { outcome: "library-not-found", selector } as const;
        }
      }
      if (libraries.length === 0) {
        return { outcome: "no-library-available" } as const;
      }
      const result = yield* queryItems({ ...request, libraries });
      return { outcome: "result", libraries, result } as const;
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
