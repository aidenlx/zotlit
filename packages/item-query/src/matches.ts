// The matches a query keeps: a bounded buffer for a limited query, sorted runs
// with a stepwise merge for an unlimited one.
import { Effect } from "effect";

import type { SortedRuns as Matches } from "@zotlit/shared/sorted-runs";
export { makeSortedRuns as allMatches } from "@zotlit/shared/sorted-runs";
export type { SortedRuns as Matches } from "@zotlit/shared/sorted-runs";

/**
 * Keeps the first `capacity` matches of the result order and drops the rest.
 * A limited query passes `limit + 1`: the extra row proves truncation.
 */
export function firstMatches<T>(
  capacity: number,
  compare: (a: T, b: T) => number,
): Matches<T> {
  const kept: T[] = [];
  const add = (row: T) => {
    if (kept.length >= capacity && compare(row, kept.at(-1)!) >= 0) return;
    let low = 0;
    let high = kept.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (compare(kept[middle]!, row) <= 0) low = middle + 1;
      else high = middle;
    }
    kept.splice(low, 0, row);
    if (kept.length > capacity) kept.pop();
  };
  return {
    add: (rows) => rows.forEach(add),
    ordered: () => Effect.succeed(kept),
  };
}
