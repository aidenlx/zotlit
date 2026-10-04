import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import { readScanPage, SCAN_PAGE_SIZE } from "@zotlit/db/item-query";
import type {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ScanRow,
} from "@zotlit/db/item-query";

import type { ItemQueryError } from "./error";
import { readField } from "./fields";
import { allMatches, firstMatches } from "./matches";
import { planRequest } from "./request";
import type { ItemQueryRequest, QueryResult, QueryRow } from "./request";

/**
 * Run one Item Query over the top-level, non-trashed Items of the Target
 * Library. Run the Effect with `ItemQueryScheduler`; cancellation is fiber
 * interruption.
 */
export function queryItems(
  request: ItemQueryRequest,
): Effect.Effect<
  QueryResult,
  ItemQueryError | ItemQueryDatabaseError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const { library } = request;
    const { query, fields } = yield* planRequest(request);
    const { limit } = query;

    const matches =
      limit === null
        ? allMatches(byModifiedThenKey)
        : firstMatches(limit + 1, byModifiedThenKey);
    let afterKey: string | null = null;
    for (;;) {
      const page: ScanRow[] = yield* readScanPage({
        libraryID: library.libraryID,
        afterKey,
      });
      yield* Effect.sync(() => {
        for (const row of page) matches.add(row);
      });
      if (page.length < SCAN_PAGE_SIZE) break;
      afterKey = page.at(-1)!.key;
    }

    const ordered = yield* Effect.sync(() => matches.ordered());
    const truncated = limit !== null && ordered.length > limit;
    const returned = truncated ? ordered.slice(0, limit) : ordered;
    const rows = yield* Effect.sync(() =>
      returned.map(
        (row): QueryRow => ({
          indexedKey: formatIndexedKey(row.key, library.groupID),
          values: Object.fromEntries(
            fields.map((name) => [name, readField(name, row)]),
          ),
        }),
      ),
    );
    return { query, rows, returnedCount: rows.length, truncated };
  });
}

function byModifiedThenKey(a: ScanRow, b: ScanRow): number {
  return (
    Temporal.Instant.compare(b.dateModified, a.dateModified) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}
