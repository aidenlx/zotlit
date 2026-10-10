import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import { HYDRATE_CHUNK_SIZE, SCAN_PAGE_SIZE } from "@zotlit/db/item-query";
import type {
  ItemQueryDatabase,
  ItemQueryReaderError,
  ScanRow,
} from "@zotlit/db/item-query";

import { compareScalars } from "./collation";
import type { SortKey } from "./fields";
import type { Matches } from "./matches";
import { allMatches, firstMatches } from "./matches";
import type { QueryConsumer, QuerySummary } from "./query";
import type { Loader } from "./record-loader";
import type {
  GroupValue,
  ItemQuery,
  QueryRow,
  TargetLibrary,
  SortSpec,
} from "./request";
import { ItemQueryTuning } from "./tuning";
import type { Tuning } from "./tuning";

interface GroupMatches<S> {
  readonly value: GroupValue;
  count: number;
  readonly matches: Matches<Match<S>>;
}

interface Match<S> {
  readonly scan: S;
  readonly keys: readonly SortKey[];
  readonly library: number;
}

type Read<A> = Effect.Effect<A, ItemQueryReaderError, ItemQueryDatabase>;

/** What the descriptor of a Query Dataset opens for one run. */
export interface DatasetRun<I extends { scan: ScanRow }> {
  readonly scan: Loader<I["scan"], I>;
  readonly projection: Loader<I["scan"], I>;
  readonly candidates: (
    library: TargetLibrary,
    tuning: Tuning,
  ) => Read<ReadonlySet<number> | null>;
  readonly matches: (item: I) => boolean;
  readonly project: (
    item: I,
    library: TargetLibrary,
    scan: I["scan"],
  ) => QueryRow;
}

/** Dataset hooks; this engine owns bounded retention, paging and delivery. */
export interface QueryRun<I extends { scan: ScanRow }> extends DatasetRun<I> {
  readonly query: ItemQuery;
  readonly warnings: QuerySummary["warnings"];
  readonly sort: readonly SortSpec[];
  readonly libraries: readonly TargetLibrary[];
  readonly readScanPage: (page: {
    libraryID: number;
    afterKey: string | null;
    size: number;
  }) => Read<readonly I["scan"][]>;
  readonly readUniverseRows: (chunk: {
    libraryID: number;
    itemIDs: readonly number[];
  }) => Read<readonly I["scan"][]>;
  readonly keys: (item: I) => readonly SortKey[];
  /** Grouped query: the distinct group values of a matched record. */
  readonly groupValues: ((item: I) => readonly GroupValue[]) | null;
}

export function consumeDataset<I extends { scan: ScanRow }, A, E, R>(
  run: QueryRun<I>,
  begin: (summary: QuerySummary) => Effect.Effect<QueryConsumer<A, E, R>, E, R>,
): Effect.Effect<A, ItemQueryReaderError | E, ItemQueryDatabase | R> {
  return Effect.gen(function* () {
    const { libraries, query } = run;
    const { limit } = query;
    const tuning = yield* ItemQueryTuning;
    const scanPageSize = sizeWithin(tuning.scanPageSize, SCAN_PAGE_SIZE);
    const hydrateChunkSize = sizeWithin(
      tuning.hydrateChunkSize,
      HYDRATE_CHUNK_SIZE,
    );
    // The scan pass: every Item is hydrated with filter, sort, and group fields
    // only, and the query keeps the scan row and the sort keys of a match.
    const compare = byKeysThenKey<I["scan"]>(run.sort, libraries);
    const retain = () =>
      limit === null
        ? allMatches(compare, sizeWithin(tuning.mergeStepSize, Infinity))
        : firstMatches(limit + 1, compare);
    const matches = retain();
    // A grouped query retains limit + 1 compact matches PER GROUP, plus the
    // current page and hydrate chunk. With limit=all it retains every match.
    const groups = new Map<GroupValue, GroupMatches<I["scan"]>>();
    let totalCount = 0;
    // Each page and each chunk lives in the Effect that reads it, so the query
    // holds no row of a page it has finished.
    /** Hydrate one chunk of a page and keep its matches. */
    const takeChunk = (library: number, chunk: readonly I["scan"][]) =>
      Effect.gen(function* () {
        const items = yield* run.scan.load(chunk, () => libraries[library]!);
        yield* Effect.sync(() => {
          const matching: Match<I["scan"]>[] = [];
          const grouped = new Map<GroupValue, Match<I["scan"]>[]>();
          for (const item of items) {
            if (!run.matches(item)) continue;
            const keys = run.keys(item);
            if (run.groupValues) {
              // A record joins one group for each of its distinct values.
              totalCount++;
              for (const value of run.groupValues(item)) {
                let group = groups.get(value);
                if (!group) {
                  group = { value, count: 0, matches: retain() };
                  groups.set(value, group);
                }
                group.count++;
                let chunk = grouped.get(value);
                if (!chunk) {
                  chunk = [];
                  grouped.set(value, chunk);
                }
                chunk.push({
                  scan: item.scan,
                  keys,
                  library,
                });
              }
            } else matching.push({ scan: item.scan, keys, library });
          }
          if (query.group === undefined) matches.add(matching);
          else
            for (const [value, chunk] of grouped)
              groups.get(value)!.matches.add(chunk);
        });
      });
    /** Hydrate one page of the query universe and keep its matches. */
    const takePage = (library: number, page: readonly I["scan"][]) =>
      Effect.gen(function* () {
        // A pass without hydration runs no statement: it takes a page at once.
        const chunkSize = run.scan.hydrates ? hydrateChunkSize : scanPageSize;
        for (let start = 0; start < page.length; start += chunkSize) {
          yield* takeChunk(library, page.slice(start, start + chunkSize));
        }
      });
    /** Read and take the scan page after `afterKey`. Null: the last page. */
    const takeScanPage = (library: number, afterKey: string | null) =>
      Effect.gen(function* () {
        const page = yield* run.readScanPage({
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
      const candidates = yield* run.candidates(library, tuning);
      if (candidates) {
        const itemIDs = [...candidates];
        for (let start = 0; start < itemIDs.length; start += scanPageSize) {
          yield* takePage(
            index,
            yield* run.readUniverseRows({
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

    const groupOrder = allMatches<GroupMatches<I["scan"]>>(
      (a, b) => compareScalars(a.value, b.value),
      sizeWithin(tuning.mergeStepSize, Infinity),
    );
    let groupChunk: GroupMatches<I["scan"]>[] = [];
    for (const group of groups.values()) {
      groupChunk.push(group);
      if (groupChunk.length < hydrateChunkSize) continue;
      const chunk = groupChunk;
      yield* Effect.sync(() => groupOrder.add(chunk));
      groupChunk = [];
    }
    yield* Effect.sync(() => groupOrder.add(groupChunk));
    const orderedGroups = yield* groupOrder.ordered();
    const batches: {
      value: GroupValue;
      count: number;
      rows: Match<I["scan"]>[];
    }[] = [];
    for (const group of orderedGroups) {
      const ordered = yield* group.matches.ordered();
      batches.push({
        value: group.value,
        count: group.count,
        rows: limit === null ? ordered : ordered.slice(0, limit),
      });
    }
    const ordered = yield* matches.ordered();
    const truncated = limit !== null && ordered.length > limit;
    const returned = truncated ? ordered.slice(0, limit) : ordered;

    // The projection pass: only the returned rows are hydrated.
    const consumer = yield* begin({
      query,
      warnings: run.warnings,
      returnedCount:
        query.group === undefined
          ? returned.length
          : batches.reduce((sum, group) => sum + group.rows.length, 0),
      truncated:
        query.group === undefined
          ? truncated
          : batches.some((group) => group.count > group.rows.length),
      ...(query.group === undefined
        ? {}
        : {
            totalCount,
            groups: batches.map(({ value, count }) => ({ value, count })),
          }),
    });
    const deliveries =
      query.group === undefined ? [{ rows: returned }] : batches;
    for (const [groupIndex, delivery] of deliveries.entries()) {
      const returned = delivery.rows;
      for (let start = 0; start < returned.length; start += hydrateChunkSize) {
        const chunk = returned.slice(start, start + hydrateChunkSize);
        const items = yield* run.projection.load(
          chunk.map((row) => row.scan),
          (index) => libraries[chunk[index]!.library]!,
        );
        const rows = yield* Effect.sync(() => {
          const rows: QueryRow[] = [];
          for (const [index, { library, scan }] of chunk.entries()) {
            const item = items[index]!;
            rows.push(run.project(item, libraries[library]!, scan));
          }
          return rows;
        });
        yield* consumer.write(
          rows,
          query.group === undefined ? undefined : groupIndex,
        );
      }
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
function byKeysThenKey<S extends ScanRow>(
  sorts: readonly SortSpec[],
  libraries: readonly TargetLibrary[],
): (a: Match<S>, b: Match<S>) => number {
  const descending = sorts.map((sort) => sort.direction === "desc");
  return (a, b) => {
    for (const [i, isDescending] of descending.entries()) {
      const x = a.keys[i]!;
      const y = b.keys[i]!;
      if (x === y) continue;
      if (x === null) return 1;
      if (y === null) return -1;
      const order = compareScalars(x, y);
      if (order !== 0) return isDescending ? -order : order;
    }
    if (a.scan.key !== b.scan.key) return a.scan.key < b.scan.key ? -1 : 1;
    if (a.library === b.library) return 0;
    const x = formatIndexedKey(a.scan.key, libraries[a.library]!.groupID);
    const y = formatIndexedKey(b.scan.key, libraries[b.library]!.groupID);
    return x < y ? -1 : x > y ? 1 : 0;
  };
}
