// Addresses rows in a list or a tree of lists by their index at each level.

/** A row's place in a tree of lists: its index at each nesting level. */
export type RowPath = readonly number[];

/** Whether `path` is `prefix` or names a row inside it. */
export function pathStartsWith(path: RowPath, prefix: RowPath): boolean {
  return (
    prefix.length <= path.length &&
    prefix.every((at, depth) => path[depth] === at)
  );
}

export function samePath(a: RowPath, b: RowPath): boolean {
  return a.length === b.length && pathStartsWith(a, b);
}
