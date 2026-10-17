// The Library Tree as data: each Library with its nested Collections, and the
// paper count of each node. A node counts what selecting it lists with no
// facet and no search: a Collection counts the distinct Items of its subtree,
// as `collections.within` selects them, so the tree and the list header agree.
//
// @see apps/obsidian/docs/adr/0071-the-library-tree-writes-filters.md
import type { QueryViewGroup } from "@/services/item-query/query-view";
import type {
  AvailableLibrary,
  LibrarySelector,
} from "@/services/library-scope/scope";
import { selectorKey } from "@/services/library-scope/scope";

import type { LibraryNode } from "./document";

export interface TreeCollection {
  /** The root-first names, the last one this Collection's own. */
  readonly path: readonly string[];
  /** The distinct Items of this Collection and its subcollections; `null` while unknown. */
  readonly count: number | null;
  readonly children: readonly TreeCollection[];
}

export interface TreeLibrary {
  readonly library: AvailableLibrary;
  /** The Items of the Library; `null` while unknown. */
  readonly count: number | null;
  readonly collections: readonly TreeCollection[];
}

/** The grouped answer that counts one Library: its Items by Collection path. */
export interface LibraryCounts {
  readonly totalCount: number;
  readonly groups: readonly Pick<QueryViewGroup, "value" | "rows">[];
}

/**
 * The Collections of one Library, nested by path, each counted from the
 * Library's Items grouped by the Collections they are filed in.
 * @param paths every live Collection of the Library as its root-first names.
 * @param counts `null` while the counts are unknown.
 */
export function collectionTree(
  paths: readonly (readonly string[])[],
  counts: LibraryCounts | null,
): TreeCollection[] {
  // `collections.within(path)` takes the Collection at `path` and every one
  // below it, so an Item counts once in each Collection on the way up from
  // each Collection it is filed in.
  const items = new Map<string, Set<string>>();
  for (const { value, rows } of counts?.groups ?? []) {
    if (typeof value !== "string") continue;
    const names = value.split("/");
    for (let depth = 1; depth <= names.length; depth++) {
      const path = names.slice(0, depth).join("/");
      let keys = items.get(path);
      if (!keys) items.set(path, (keys = new Set()));
      for (const { indexedKey } of rows) keys.add(indexedKey);
    }
  }
  const children = Map.groupBy(
    // Two sibling Collections of one name are one path, as everywhere in
    // ZotLit Query.
    [...new Map(paths.map((path) => [path.join("/"), path])).values()],
    (path) => path.slice(0, -1).join("/"),
  );
  // A Collection whose parent the read leaves out has no place in the tree.
  const build = (parent: string): TreeCollection[] =>
    (children.get(parent) ?? []).map((path) => {
      const own = path.join("/");
      return {
        path,
        count: counts ? (items.get(own)?.size ?? 0) : null,
        children: build(own),
      };
    });
  return build("");
}

/** The tree node `node` names in `libraries`, or `null` where the tree has none. */
export function findNode(
  libraries: readonly TreeLibrary[],
  node: LibraryNode,
): TreeLibrary | TreeCollection | null {
  const library = libraries.find((entry) =>
    sameLibrary(entry.library.selector, node.library),
  );
  if (!library || node.kind === "library") return library ?? null;
  let level: readonly TreeCollection[] = library.collections;
  let found: TreeCollection | null = null;
  for (const [depth, name] of node.path.entries()) {
    found = level.find(({ path }) => path[depth] === name) ?? null;
    if (!found) return null;
    level = found.children;
  }
  return found;
}

export function sameLibrary(a: LibrarySelector, b: LibrarySelector): boolean {
  return selectorKey(a) === selectorKey(b);
}
