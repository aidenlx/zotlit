import { Effect } from "effect";

/** Sorted chunks accumulated and merged through bounded Effect steps. */
export interface SortedRuns<T> {
  /** Take one chunk of matches. The call owns `rows`. */
  add(rows: T[]): void;
  /** The kept rows in result order. */
  ordered(): Effect.Effect<T[]>;
}

/**
 * Keeps every match; an unlimited query returns them all. Each added chunk
 * becomes one sorted run, and `ordered` merges the runs two at a time. One
 * merge step is one Effect of at most `mergeStepSize` rows, so the
 * scheduler can end a slice, or interrupt the query, between two steps.
 */
export function makeSortedRuns<T>(
  compare: (a: T, b: T) => number,
  mergeStepSize: number,
): SortedRuns<T> {
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
            merged.push(
              right
                ? yield* mergeRuns(left, right, { compare, mergeStepSize })
                : left,
            );
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
  options: { compare: (a: T, b: T) => number; mergeStepSize: number },
): Effect.Effect<T[]> {
  const { compare, mergeStepSize } = options;
  return Effect.gen(function* () {
    const merged: T[] = [];
    const total = left.length + right.length;
    let l = 0;
    let r = 0;
    while (merged.length < total) {
      yield* Effect.sync(() => {
        const end = Math.min(total, merged.length + mergeStepSize);
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
