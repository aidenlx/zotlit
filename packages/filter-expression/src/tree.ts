// The Filter Tree: a filter stored in the Bases `filters` shape, and the one
// walk over it that every reader, writer, and evaluator shares.

/**
 * A stored filter: one Filter Expression, or a group of filters. An `and`
 * group holds when every entry holds, an `or` group when one does, and a
 * `not` group when none does. An empty `and` or `not` group holds for every
 * record; an empty `or` group holds for none.
 */
export type FilterTree =
  | string
  | { readonly and: readonly FilterTree[] }
  | { readonly or: readonly FilterTree[] }
  | { readonly not: readonly FilterTree[] };

export type FilterGroupKind = "and" | "or" | "not";

/**
 * The place of an entry: its index in each group from the root down. The
 * root group's path is `[]`; a filter that is one Filter Expression reads as
 * the only entry of an `and` root, so its path is `[0]`.
 */
export type FilterPath = readonly number[];

/** What {@link foldFilterTree} makes of each leaf and each group. */
export interface FilterTreeFold<T> {
  leaf: (expression: string, path: FilterPath) => T;
  group: (kind: FilterGroupKind, entries: T[], path: FilterPath) => T;
}

/** The kind and entries of a group. */
export function filterGroup(
  tree: Exclude<FilterTree, string>,
): [FilterGroupKind, readonly FilterTree[]] {
  return "and" in tree
    ? ["and", tree.and]
    : "or" in tree
      ? ["or", tree.or]
      : ["not", tree.not];
}

/** `tree`, folded from its leaves up, each part told its {@link FilterPath}. */
export function foldFilterTree<T>(
  tree: FilterTree,
  fold: FilterTreeFold<T>,
): T {
  const visit = (node: FilterTree, path: FilterPath): T => {
    if (typeof node === "string") return fold.leaf(node, path);
    const [kind, entries] = filterGroup(node);
    return fold.group(
      kind,
      entries.map((entry, index) => visit(entry, [...path, index])),
      path,
    );
  };
  return typeof tree === "string" ? fold.leaf(tree, [0]) : visit(tree, []);
}

/**
 * Reads a stored filter from a YAML or JSON value; `null` when the value is
 * not one. A number or a boolean reads as its Filter Expression text.
 */
export function readFilterTree(value: unknown): FilterTree | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  const [key] = keys as [string];
  const entries = (value as Record<string, unknown>)[key];
  if (!Array.isArray(entries)) return null;
  const read = entries.map(readFilterTree);
  if (read.includes(null)) return null;
  const children = read as FilterTree[];
  switch (key) {
    case "and":
      return { and: children };
    case "or":
      return { or: children };
    case "not":
      return { not: children };
    default:
      return null;
  }
}

/** One leaf of a composed filter: its path, and its span in the text. */
export interface FilterLeaf {
  readonly path: FilterPath;
  readonly from: number;
  readonly to: number;
}

/** A filter as one Filter Expression, with the span of each leaf in it. */
export interface ComposedFilter<Leaf extends FilterLeaf = FilterLeaf> {
  readonly text: string;
  readonly leaves: readonly Leaf[];
}

const shift = <Leaf extends FilterLeaf>(
  leaves: readonly Leaf[],
  by: number,
): Leaf[] =>
  leaves.map((leaf) => ({ ...leaf, from: leaf.from + by, to: leaf.to + by }));

/**
 * Joins filters with `joiner`, each one wrapped so it binds as one operand;
 * a lone filter stays as it is. The leaves keep what else they carry.
 */
export function joinComposed<Leaf extends FilterLeaf>(
  parts: readonly ComposedFilter<Leaf>[],
  joiner: string,
): ComposedFilter<Leaf> {
  if (parts.length === 1) return parts[0]!;
  let text = "";
  const leaves: Leaf[] = [];
  parts.forEach((part, index) => {
    if (index > 0) text += joiner;
    text += "(";
    leaves.push(...shift(part.leaves, text.length));
    text += `${part.text})`;
  });
  return { text, leaves };
}

/**
 * The Filter Expression with the meaning of `tree`, and where each leaf
 * sits in it, so that a fault in the text points back to its leaf.
 */
export function composeFilterTree(tree: FilterTree): ComposedFilter {
  return foldFilterTree<ComposedFilter>(tree, {
    leaf: (text, path) => ({
      text,
      leaves: [{ path, from: 0, to: text.length }],
    }),
    group: (kind, entries) => {
      if (entries.length === 0)
        return { text: kind === "or" ? "false" : "true", leaves: [] };
      if (kind === "and") return joinComposed(entries, " && ");
      const any = joinComposed(entries, " || ");
      if (kind === "or") return any;
      // A `not` group holds when none of its entries does.
      return { text: `!(${any.text})`, leaves: shift(any.leaves, 2) };
    },
  });
}
