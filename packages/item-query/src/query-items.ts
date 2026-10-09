import { getLogger } from "@logtape/logtape";
import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import {
  readLibraryRowCount,
  readScanPage,
  readUniverseRows,
} from "@zotlit/db/item-query";
import type {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";

import { planCandidates, readCandidates } from "./candidate-plan";
import type { ItemQueryError } from "./error";
import { consumeDataset } from "./execution";
import { matches as isMatch } from "./filter-evaluate";
import { openHydration } from "./hydration";
import { readPath } from "./projection";
import { readQueryClock } from "./query-clock";
import { planRequest } from "./request";
import type { ItemQueryRequest, QueryResult, QueryRow } from "./request";

const logger = getLogger(["zotlit", "item-query"]);

/** Metadata known before the projection pass begins. */
export type QuerySummary = Omit<QueryResult, "rows">;

/** Each write completes before the engine projects the next chunk. */
export interface QueryConsumer<A, E = never, R = never> {
  write(rows: readonly QueryRow[]): Effect.Effect<void, E, R>;
  end(): Effect.Effect<A, E, R>;
}

/**
 * Run one Item Query over the top-level, non-trashed Items of the Target
 * Libraries, as one result set. Run the Effect with `ItemQueryScheduler`;
 * cancellation is fiber interruption.
 */
export function queryItems(
  request: ItemQueryRequest,
): Effect.Effect<
  QueryResult,
  ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return consumeQueryItems(request, (summary) =>
    Effect.sync(() => {
      const rows: QueryRow[] = [];
      return {
        write: (chunk) =>
          Effect.sync(() => {
            for (const row of chunk) rows.push(row);
          }),
        end: () => Effect.succeed({ ...summary, rows }),
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
export function consumeQueryItems<A, E, R>(
  request: ItemQueryRequest,
  begin: (summary: QuerySummary) => Effect.Effect<QueryConsumer<A, E, R>, E, R>,
): Effect.Effect<
  A,
  ItemQueryError | ItemQueryLayoutError | ItemQueryDatabaseError | E,
  ItemQueryDatabase | R
> {
  return Effect.gen(function* () {
    const { libraries } = request;
    const { query, filter, paths, sorts } = yield* planRequest(request);
    const clock = yield* readQueryClock;
    const hydration = yield* openHydration({ filter, paths, sorts }, libraries);
    return yield* consumeDataset(
      {
        query,
        libraries,
        sort: query.sort,
        scan: hydration.scan,
        projection: hydration.projection,
        readScanPage,
        readUniverseRows,
        candidates: (library, tuning) =>
          Effect.gen(function* () {
            const candidatePlan =
              filter && !tuning.forceScan
                ? planCandidates(
                    filter.root,
                    hydration.candidateSources(library),
                  )
                : null;
            const cap = candidatePlan
              ? Math.floor(
                  (yield* readLibraryRowCount(library.libraryID)) *
                    tuning.capRatio,
                )
              : null;
            const candidates = candidatePlan
              ? yield* readCandidates(candidatePlan, library.libraryID, cap!)
              : null;
            logger.debug("Item Query uses {plan} for Library {libraryID}", {
              libraryID: library.libraryID,
              groupID: library.groupID,
              plan: candidates === null ? "scan" : "candidates",
              candidateCount: candidates?.size ?? null,
              candidateCap: cap,
              reason:
                candidates !== null
                  ? null
                  : !filter
                    ? "no-filter"
                    : tuning.forceScan
                      ? "forced-scan"
                      : candidatePlan
                        ? "candidate-cap-exceeded"
                        : "unsupported-filter",
            });
            return candidates;
          }),
        matches: (item) => !filter || isMatch(filter.root, item, clock),
        keys: (item) => sorts.map((sort) => sort.key(item, clock)),
        project: (item, library, scan) => ({
          indexedKey: formatIndexedKey(scan.key, library.groupID),
          values: Object.fromEntries(
            paths.map((path) => [path.text, readPath(path, item)]),
          ),
        }),
      },
      begin,
    );
  });
}
