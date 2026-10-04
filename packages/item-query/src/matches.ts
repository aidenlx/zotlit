import { Effect } from "effect";

/** The matching rows a query keeps while it reads the Library. */
export interface Matches<T> {
  /** Take one chunk of matches. The call owns `rows`. */
  add(rows: T[]): void;
  /** The kept rows in result order. */
  ordered(): Effect.Effect<T[]>;
}

/** The rows one merge step moves at most. */
export const MERGE_STEP_SIZE = 500;

/**
 * Keeps every match; an unlimited query returns them all. Each added chunk
 * becomes one sorted run, and `ordered` merges the runs two at a time. One
 * merge step is one Effect of at most {@link MERGE_STEP_SIZE} rows, so the
 * scheduler can end a slice, or interrupt the query, between two steps.
 */
export function allMatches<T>(compare: (a: T, b: T) => number): Matches<T> {
  let runs: T[][] = [];
  return {
    add: (rows) => void runs.push(rows.sort(compare)),
    ordered: () =>
      Effect.gen(function* () {
        while (runs.length > 1) {
          const merged: T[][] = [];
          for (let i = 0; i < runs.length; i += 2) {
            const left = runs[i]!;
            const right = runs[i + 1];
            merged.push(right ? yield* mergeRuns(left, right, compare) : left);
          }
          runs = merged;
        }
        return runs[0] ?? [];
      }),
  };
}

function mergeRuns<T>(
  left: readonly T[],
  right: readonly T[],
  compare: (a: T, b: T) => number,
): Effect.Effect<T[]> {
  return Effect.gen(function* () {
    const merged: T[] = [];
    const total = left.length + right.length;
    let l = 0;
    let r = 0;
    while (merged.length < total) {
      yield* Effect.sync(() => {
        const end = Math.min(total, merged.length + MERGE_STEP_SIZE);
        while (merged.length < end) {
          const fromLeft =
            r >= right.length ||
            (l < left.length && compare(left[l]!, right[r]!) <= 0);
          merged.push(fromLeft ? left[l++]! : right[r++]!);
        }
      });
    }
    return merged;
  });
}

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
