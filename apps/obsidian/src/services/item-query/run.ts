// Resolves the Target Libraries of one Item Query and runs it on the database
// of the job (`ItemQueryDatabase`). The Query Job (`job.ts`) provides that
// database and the time-budget scheduler.
import { Data, Effect } from "effect";

import { readLibraries } from "@zotlit/db/item-query";
import type {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
import { consumeQueryItems, consumeQueryAnnotations } from "@zotlit/item-query";
import type {
  ItemQueryError,
  AnnotationQueryRequest,
  AnnotationQueryOptions,
  QueryConsumer,
  QuerySummary,
} from "@zotlit/item-query";

import { resolveLibraryScope } from "@/services/library-scope/scope";
import type {
  LibraryScope,
  LibrarySelector,
  ResolvedLibraryScope,
} from "@/services/library-scope/scope";

/**
 * Wraps the operation of one run before it starts, to provide the observer
 * references of the engine. Only the dev-build measurement command passes one.
 */
export type ItemQueryInstrument = <A, E, R>(
  operation: Effect.Effect<A, E, R>,
) => Effect.Effect<A, E, R>;

/** The Libraries a run reads. */
export interface RunLibraries extends AnnotationQueryOptions {
  readonly kind?: "annotations";
  /** The Library Scope in force, or the scope that the caller names. */
  readonly scope: LibraryScope;
  /** The run needs each Library of `scope`: the caller named them. */
  readonly requireEach: boolean;
}

/**
 * The source holds no Target Library for the run, so the run reads no Item.
 */
export class TargetLibrariesUnavailable extends Data.TaggedError(
  "TargetLibrariesUnavailable",
)<{
  /**
   * - `named-missing`: the caller named a Library that the source does not
   *   hold.
   * - `named-none`: the caller named the Libraries, such as all of them, and
   *   the source holds none.
   * - `scope-none`: the source holds no Library of the Library Scope in force.
   */
  readonly reason: "named-missing" | "named-none" | "scope-none";
  /**
   * For `named-missing`: the first named Library that the source does not
   * hold, in the canonical order.
   */
  readonly missing?: LibrarySelector;
}> {}

/**
 * Resolve the Target Libraries and run one Item Query on the database of the
 * job; the consumer of `begin` receives the projection chunks. The Query
 * Clock is the system clock and zone.
 */
export function runItemQueryTo<A, E, R>(
  { scope, requireEach, ...options }: RunLibraries,
  request: Omit<AnnotationQueryRequest, "libraries">,
  begin: (
    summary: QuerySummary,
    libraries: ResolvedLibraryScope,
  ) => Effect.Effect<QueryConsumer<A, E, R>, E, R>,
): Effect.Effect<
  A,
  | ItemQueryError
  | ItemQueryLayoutError
  | ItemQueryDatabaseError
  | TargetLibrariesUnavailable
  | E,
  ItemQueryDatabase | R
> {
  return Effect.gen(function* () {
    // The resolution of the Library Scope service, on the rows of the one
    // Library reader of `getLibraries`, read on the borrowed client.
    const libraries = resolveLibraryScope(yield* readLibraries(), scope);
    const { available, unavailable } = libraries;
    const [missing] = unavailable;
    if (requireEach && missing) {
      return yield* new TargetLibrariesUnavailable({
        reason: "named-missing",
        missing,
      });
    }
    if (available.length === 0) {
      return yield* new TargetLibrariesUnavailable({
        reason: requireEach ? "named-none" : "scope-none",
      });
    }
    const consume =
      options.kind === "annotations"
        ? consumeQueryAnnotations
        : consumeQueryItems;
    return yield* consume(
      {
        ...request,
        libraries: available.map(({ libraryID, selector }) => ({
          libraryID,
          groupID: selector.type === "group" ? selector.groupID : null,
        })),
      },
      (summary) => begin(summary, libraries),
      options,
    );
  });
}
