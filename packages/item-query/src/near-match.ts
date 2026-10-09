/** Rank the registered names close enough to a name that was not found. */
export function nearMatches(
  name: string,
  candidates: readonly string[],
): readonly string[] {
  const needle = name.toLowerCase();
  const threshold = Math.max(1, Math.floor(name.length / 3));
  return candidates
    .flatMap((candidate, index) => {
      if (candidate === name) return [];
      const value = candidate.toLowerCase();
      const distance = editDistance(needle, value);
      const rank =
        value === needle
          ? 0
          : value.startsWith(needle) || lastSegment(value) === needle
            ? 1
            : distance <= threshold
              ? 2
              : null;
      return rank === null ? [] : [{ candidate, rank, distance, index }];
    })
    .toSorted((left, right) =>
      left.rank !== right.rank
        ? left.rank - right.rank
        : left.distance !== right.distance
          ? left.distance - right.distance
          : left.index - right.index,
    )
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}

function lastSegment(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? path : path.slice(dot + 1);
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current.push(
        Math.min(
          previous[rightIndex]! + 1,
          current[rightIndex - 1]! + 1,
          previous[rightIndex - 1]! +
            (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}
