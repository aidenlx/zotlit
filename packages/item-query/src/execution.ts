import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import { HYDRATE_CHUNK_SIZE, SCAN_PAGE_SIZE } from "@zotlit/db/item-query";
import type {
  ItemQueryDatabase,
  ItemQueryReaderError,
  ScanRow,
} from "@zotlit/db/item-query";

import { compareStrings } from "./collation";
import type { SortKey } from "./fields";
import { allMatches, firstMatches } from "./matches";
import type { QueryConsumer, QuerySummary } from "./query-items";
import type { ItemQuery, QueryRow, TargetLibrary, SortSpec } from "./request";
import { ItemQueryTuning } from "./tuning";
import type { Tuning } from "./tuning";

interface Match<S> {
  readonly scan: S;
  readonly keys: readonly SortKey[];
  readonly library: number;
}

type Read<A> = Effect.Effect<A, ItemQueryReaderError, ItemQueryDatabase>;
interface DatasetLoader<S, I> {
  readonly plan: unknown;
  readonly load: (chunk: readonly S[]) => Read<readonly I[]>;
}

/** Dataset hooks; this engine owns bounded retention, paging and delivery. */
export interface QueryDataset<S extends ScanRow, I extends { scan: S }> {
  readonly query: ItemQuery;
  readonly sort: readonly SortSpec[];
  readonly libraries: readonly TargetLibrary[];
  readonly scan: DatasetLoader<S, I>;
  readonly projection: DatasetLoader<S, I>;
  readonly readScanPage: (page: {
    libraryID: number;
    afterKey: string | null;
    size: number;
  }) => Read<readonly S[]>;
  readonly readUniverseRows: (chunk: {
    libraryID: number;
    itemIDs: readonly number[];
  }) => Read<readonly S[]>;
  readonly candidates: (
    library: TargetLibrary,
    tuning: Tuning,
  ) => Read<ReadonlySet<number> | null>;
  readonly matches: (item: I, library: number) => boolean;
  readonly keys: (item: I) => readonly SortKey[];
  readonly project: (item: I, library: TargetLibrary, scan: S) => QueryRow;
}

export function consumeDataset<
  S extends ScanRow,
  I extends { scan: S },
  A,
  E,
  R,
>(
  dataset: QueryDataset<S, I>,
  begin: (summary: QuerySummary) => Effect.Effect<QueryConsumer<A, E, R>, E, R>,
): Effect.Effect<A, ItemQueryReaderError | E, ItemQueryDatabase | R> {
  return Effect.gen(function* () {
    const { libraries, query } = dataset;
    const { limit } = query;
    const tuning = yield* ItemQueryTuning;
    const scanPageSize = sizeWithin(tuning.scanPageSize, SCAN_PAGE_SIZE);
    const hydrateChunkSize = sizeWithin(
      tuning.hydrateChunkSize,
      HYDRATE_CHUNK_SIZE,
    );
    // The scan pass: every Item is hydrated with the filter and sort fields
    // only, and the query keeps the scan row and the sort keys of a match.
    const compare = byKeysThenKey<S>(dataset.sort, libraries);
    const matches =
      limit === null
        ? allMatches(compare, sizeWithin(tuning.mergeStepSize, Infinity))
        : firstMatches(limit + 1, compare);
    // Each page and each chunk lives in the Effect that reads it, so the query
    // holds no row of a page it has finished.
    /** Hydrate one chunk of a page and keep its matches. */
    const takeChunk = (library: number, chunk: readonly S[]) =>
      Effect.gen(function* () {
        const items = yield* dataset.scan.load(chunk);
        yield* Effect.sync(() => {
          const matching: Match<S>[] = [];
          for (const item of items) {
            if (!dataset.matches(item, library)) continue;
            const keys = dataset.keys(item);
            matching.push({ scan: item.scan, keys, library });
          }
          matches.add(matching);
        });
      });
    /** Hydrate one page of the query universe and keep its matches. */
    const takePage = (library: number, page: readonly S[]) =>
      Effect.gen(function* () {
        const chunkSize = dataset.scan.plan ? hydrateChunkSize : scanPageSize;
        for (let start = 0; start < page.length; start += chunkSize) {
          yield* takeChunk(library, page.slice(start, start + chunkSize));
        }
      });
    /** Read and take the scan page after `afterKey`. Null: the last page. */
    const takeScanPage = (library: number, afterKey: string | null) =>
      Effect.gen(function* () {
        const page = yield* dataset.readScanPage({
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
      const candidates = yield* dataset.candidates(library, tuning);
      if (candidates) {
        const itemIDs = [...candidates];
        for (let start = 0; start < itemIDs.length; start += scanPageSize) {
          yield* takePage(
            index,
            yield* dataset.readUniverseRows({
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
      const items = yield* dataset.projection.load(
        chunk.map((row) => row.scan),
      );
      const rows = yield* Effect.sync(() => {
        const rows: QueryRow[] = [];
        for (const [index, { library, scan }] of chunk.entries()) {
          const item = items[index]!;
          rows.push(dataset.project(item, libraries[library]!, scan));
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
