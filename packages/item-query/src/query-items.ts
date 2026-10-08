import { getLogger } from "@logtape/logtape";
import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import {
  HYDRATE_CHUNK_SIZE,
  readLibraryRowCount,
  readScanPage,
  readUniverseRows,
  SCAN_PAGE_SIZE,
} from "@zotlit/db/item-query";
import type {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
  ScanRow,
} from "@zotlit/db/item-query";

import { planCandidates, readCandidates } from "./candidate-plan";
import { compareStrings } from "./collation";
import type { ItemQueryError } from "./error";
import type { SortKey } from "./fields";
import { matches as isMatch } from "./filter-evaluate";
import { openHydration } from "./hydration";
import { allMatches, firstMatches } from "./matches";
import { readPath } from "./projection";
import { readQueryClock } from "./query-clock";
import { planRequest } from "./request";
import type {
  ItemQueryRequest,
  PlannedSort,
  QueryResult,
  QueryRow,
  TargetLibrary,
} from "./request";
import { ItemQueryTuning } from "./tuning";

const logger = getLogger(["zotlit", "item-query"]);

/** One match while the query orders it. */
interface Match {
  readonly scan: ScanRow;
  /** One key for each entry of the sort list. */
  readonly keys: readonly SortKey[];
  /** The Library of the match, as its index in the Target Libraries. */
  readonly library: number;
}

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
    const { limit } = query;
    // One instant and one time zone for every date in the query.
    const clock = yield* readQueryClock;
    const tuning = yield* ItemQueryTuning;
    const scanPageSize = sizeWithin(tuning.scanPageSize, SCAN_PAGE_SIZE);
    const hydrateChunkSize = sizeWithin(
      tuning.hydrateChunkSize,
      HYDRATE_CHUNK_SIZE,
    );

    const hydration = yield* openHydration({ filter, paths, sorts }, libraries);

    // The scan pass: every Item is hydrated with the filter and sort fields
    // only, and the query keeps the scan row and the sort keys of a match.
    const compare = byKeysThenKey(sorts, libraries);
    const matches =
      limit === null
        ? allMatches(compare, sizeWithin(tuning.mergeStepSize, Infinity))
        : firstMatches(limit + 1, compare);
    // Each page and each chunk lives in the Effect that reads it, so the query
    // holds no row of a page it has finished.
    /** Hydrate one chunk of a page and keep its matches. */
    const takeChunk = (library: number, chunk: readonly ScanRow[]) =>
      Effect.gen(function* () {
        const items = yield* hydration.scan.load(chunk);
        yield* Effect.sync(() => {
          const matching: Match[] = [];
          for (const item of items) {
            if (filter && !isMatch(filter.root, item, clock)) continue;
            const keys = sorts.map((sort) => sort.key(item, clock));
            matching.push({ scan: item.scan, keys, library });
          }
          matches.add(matching);
        });
      });
    /** Hydrate one page of the query universe and keep its matches. */
    const takePage = (library: number, page: readonly ScanRow[]) =>
      Effect.gen(function* () {
        const chunkSize = hydration.scan.plan ? hydrateChunkSize : scanPageSize;
        for (let start = 0; start < page.length; start += chunkSize) {
          yield* takeChunk(library, page.slice(start, start + chunkSize));
        }
      });
    /** Read and take the scan page after `afterKey`. Null: the last page. */
    const takeScanPage = (library: number, afterKey: string | null) =>
      Effect.gen(function* () {
        const page = yield* readScanPage({
          libraryID: libraries[library]!.libraryID,
          afterKey,
          size: scanPageSize,
        });
        yield* takePage(library, page);
        return page.length < scanPageSize ? null : page.at(-1)!.key;
      });

    // Each Library has its own plan. The candidate pass reads the Items that
    // the lowered leaves of the filter name in the Library, against the cap of
    // that Library; the Library scan reads every Item. The evaluator decides
    // the match on both paths, and the matches of every Library go to the one
    // result order.
    for (const [index, library] of libraries.entries()) {
      const { libraryID } = library;
      const candidatePlan =
        filter && !tuning.forceScan
          ? planCandidates(filter.root, hydration.candidateSources(library))
          : null;
      const candidateCap = candidatePlan
        ? Math.floor((yield* readLibraryRowCount(libraryID)) * tuning.capRatio)
        : null;
      const candidates = candidatePlan
        ? yield* readCandidates(candidatePlan, libraryID, candidateCap!)
        : null;
      logger.debug("Item Query uses {plan} for Library {libraryID}", {
        libraryID,
        groupID: library.groupID,
        plan: candidates === null ? "scan" : "candidates",
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
        candidateCount: candidates?.size ?? null,
        candidateCap,
      });
      if (candidates) {
        const itemIDs = [...candidates];
        for (let start = 0; start < itemIDs.length; start += scanPageSize) {
          yield* takePage(
            index,
            yield* readUniverseRows({
              libraryID,
              itemIDs: itemIDs.slice(start, start + scanPageSize),
            }),
          );
        }
      } else {
        let afterKey: string | null = null;
        do afterKey = yield* takeScanPage(index, afterKey);
        while (afterKey !== null);
      }
    }

    const ordered = yield* matches.ordered();
    const truncated = limit !== null && ordered.length > limit;
    const returned = truncated ? ordered.slice(0, limit) : ordered;

    // The projection pass: only the returned rows are hydrated.
    const consumer = yield* begin({
      query,
      returnedCount: returned.length,
      truncated,
    });
    for (let start = 0; start < returned.length; start += hydrateChunkSize) {
      const chunk = returned.slice(start, start + hydrateChunkSize);
      const items = yield* hydration.projection.load(
        chunk.map((row) => row.scan),
      );
      const rows = yield* Effect.sync(() => {
        const rows: QueryRow[] = [];
        for (const [index, { library, scan }] of chunk.entries()) {
          const item = items[index]!;
          rows.push({
            indexedKey: formatIndexedKey(scan.key, libraries[library]!.groupID),
            values: Object.fromEntries(
              paths.map((path) => [path.text, readPath(path, item)]),
            ),
          });
        }
        return rows;
      });
      yield* consumer.write(rows);
    }
    return yield* consumer.end();
  });
}

/** A tuned size as a whole number from one to the upper limit of its reader. */
function sizeWithin(size: number, limit: number): number {
  return Math.max(1, Math.min(Math.floor(size), limit));
}

/**
 * The result order: each Sortable Field in turn, a missing value last in both
 * directions, and the Indexed Key as the final tie-breaker. Every Zotero Key
 * has one length, so the order of the Zotero Keys is the order of the Indexed
 * Keys; the same Zotero Key in two Libraries compares by the Indexed Key.
 */
function byKeysThenKey(
  sorts: readonly PlannedSort[],
  libraries: readonly TargetLibrary[],
): (a: Match, b: Match) => number {
  const descending = sorts.map((sort) => sort.direction === "desc");
  return (a, b) => {
    for (const [i, isDescending] of descending.entries()) {
      const x = a.keys[i]!;
      const y = b.keys[i]!;
      if (x === y) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      const order =
        typeof x === "string"
          ? compareStrings(x, y as string)
          : x - (y as number);
      if (order !== 0) return isDescending ? -order : order;
    }
    if (a.scan.key !== b.scan.key) return a.scan.key < b.scan.key ? -1 : 1;
    if (a.library === b.library) return 0;
    const x = formatIndexedKey(a.scan.key, libraries[a.library]!.groupID);
    const y = formatIndexedKey(b.scan.key, libraries[b.library]!.groupID);
    return x < y ? -1 : x > y ? 1 : 0;
  };
}
