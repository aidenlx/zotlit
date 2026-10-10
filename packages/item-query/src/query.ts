// The operations of the engine: one query of a Query Dataset, delivered to a
// consumer in projection chunks or collected into the complete Query Result.
import { Effect } from "effect";

import type {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";

import { collectionWarnings } from "./collection-warnings";
import type { QueryDataset } from "./dataset";
import { diagnoseWarning } from "./diagnose";
import type { ItemQueryError } from "./error";
import { consumeDataset } from "./execution";
import { indexedKeyWarnings } from "./indexed-key-selection";
import { readQueryClock } from "./query-clock";
import { planRequest } from "./request";
import type {
  ItemQueryRequest,
  QueryResult,
  QueryRow,
  QueryMetadata,
  QueryGroup,
} from "./request";

/** Metadata known before the projection pass begins. */
export interface QuerySummary extends QueryMetadata {
  readonly groups?: readonly Omit<QueryGroup, "rows">[];
  readonly totalCount?: number;
}

/** Each write completes before the engine projects the next chunk. */
export interface QueryConsumer<A, E = never, R = never> {
  /** groupIndex addresses summary.groups; each chunk belongs to one group. */
  write(
    rows: readonly QueryRow[],
    groupIndex?: number,
  ): Effect.Effect<void, E, R>;
  end(): Effect.Effect<A, E, R>;
}

/**
 * Run one query of the Query Dataset over the Target Libraries, as one result
 * set. Run the Effect with `ItemQueryScheduler`; cancellation is fiber
 * interruption.
 */
export function collectQuery<Request extends ItemQueryRequest>(
  dataset: QueryDataset<Request>,
  request: Request,
): Effect.Effect<
  QueryResult,
  ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return consumeQuery(dataset, request, (summary) =>
    Effect.sync(() => {
      const rows: QueryRow[] = [];
      const { groups: summaries, totalCount, ...metadata } = summary;
      const groups = summaries?.map((group) => ({
        ...group,
        rows: [] as QueryRow[],
      }));
      return {
        write: (chunk, groupIndex) =>
          Effect.sync(() => {
            const target =
              groups && groupIndex !== undefined
                ? groups[groupIndex]!.rows
                : rows;
            for (const row of chunk) target.push(row);
          }),
        end: () =>
          Effect.succeed<QueryResult>(
            groups
              ? { ...metadata, totalCount: totalCount!, groups }
              : { ...metadata, rows },
          ),
      };
    }),
  );
}

/**
 * Deliver the same query in final-order projection chunks. Begin runs once
 * after ordering, including for an empty result. Failure or interruption stops
 * delivery; end runs only after every write succeeds. Consumer state belongs
 * inside begin, so each execution is independent.
 */
export function consumeQuery<Request extends ItemQueryRequest, A, E, R>(
  dataset: QueryDataset<Request>,
  request: Request,
  begin: (summary: QuerySummary) => Effect.Effect<QueryConsumer<A, E, R>, E, R>,
): Effect.Effect<
  A,
  ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError | E,
  ItemQueryDatabase | R
> {
  return Effect.gen(function* () {
    const plan = yield* planRequest(dataset, request);
    const { query, sorts } = plan;
    const clock = yield* readQueryClock;
    const run = yield* dataset.open(plan, request, clock);
    return yield* consumeDataset(
      {
        ...run,
        query,
        warnings: [
          ...plan.warnings,
          ...(yield* collectionWarnings(
            plan.filter?.root,
            request.libraries,
            run.collectionPaths,
          )),
          ...(plan.filter
            ? indexedKeyWarnings(
                plan.filter.root,
                dataset.id,
                request.libraries,
              )
            : []),
        ]
          .sort((a, b) => a.at.from - b.at.from)
          .map((fault) =>
            diagnoseWarning(fault, query.filter!, { clock, dataset }),
          ),
        libraries: request.libraries,
        sort: plan.order,
        readScanPage: dataset.readScanPage,
        readUniverseRows: dataset.readUniverseRows,
        keys: (item) => sorts.map((sort) => sort.key(item, clock)),
      },
      begin,
    );
  });
}
