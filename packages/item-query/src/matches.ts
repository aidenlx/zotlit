/** The matching rows a query keeps while it reads the Library. */
export interface Matches<T> {
  add(row: T): void;
  /** The kept rows in result order. */
  ordered(): T[];
}

/** Keeps every match; an unlimited query returns them all. */
export function allMatches<T>(compare: (a: T, b: T) => number): Matches<T> {
  const rows: T[] = [];
  return {
    add: (row) => void rows.push(row),
    ordered: () => rows.sort(compare),
  };
}

/**
 * Keeps the first `capacity` matches of the result order and drops the rest.
 * A limited query passes `limit + 1`: the extra row proves truncation.
 */
export function firstMatches<T>(
  capacity: number,
  compare: (a: T, b: T) => number,
): Matches<T> {
  const rows: T[] = [];
  return {
    add: (row) => {
      if (rows.length >= capacity && compare(row, rows.at(-1)!) >= 0) return;
      let low = 0;
      let high = rows.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (compare(rows[middle]!, row) <= 0) low = middle + 1;
        else high = middle;
      }
      rows.splice(low, 0, row);
      if (rows.length > capacity) rows.pop();
    },
    ordered: () => rows,
  };
}
