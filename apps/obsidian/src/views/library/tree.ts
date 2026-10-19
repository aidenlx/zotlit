// The Library Tree as data: each Library with its nested Collections, and the
// paper count of each node. A node counts what selecting it lists with no
// facet and no search: a Collection counts the distinct Items of its subtree,
// as `collections.within` selects them, so the tree and the list header agree.
//
// @see apps/obsidian/docs/adr/0072-the-library-tree-writes-filters.md
import { parseIndexedKey } from "@zotlit/db";

import type { QueryViewGroup } from "@/services/item-query/query-view";
import type {
  AvailableLibrary,
  LibrarySelector,
} from "@/services/library-scope/scope";
import { selectorKey } from "@/services/library-scope/scope";

import { nodeKey } from "./document";
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
  // Recent is no node of a Library, and counts nothing.
  if (node.kind === "recent") return null;
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

/** The Library that holds the Item `indexedKey`, as its key names it. */
export function libraryOf(indexedKey: string): LibrarySelector | null {
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return null;
  return parsed.groupID === null
    ? { type: "personal" }
    : { type: "group", groupID: parsed.groupID };
}

/** The mark before the {@link nodeKey} of a Library the researcher closed. */
export const CLOSED_PREFIX = "closed:";

/**
 * Whether the tree knows the open-node key `key` once `libraries` are read:
 * a node of a Library read in full must be in it; the nodes of a Library the
 * tree did not read, or read in part, stay for a later read.
 */
export function knowsNode(
  libraries: readonly { tree: TreeLibrary; complete: boolean }[],
): (key: string) => boolean {
  const known = new Set<string>();
  const read = new Set<string>();
  const walk = (library: LibrarySelector, list: readonly TreeCollection[]) => {
    for (const { path, children } of list) {
      known.add(nodeKey({ kind: "collection", library, path }));
      walk(library, children);
    }
  };
  for (const { tree, complete } of libraries) {
    if (!complete) continue;
    const { selector } = tree.library;
    read.add(selectorKey(selector));
    known.add(
      `${CLOSED_PREFIX}${nodeKey({ kind: "library", library: selector })}`,
    );
    walk(selector, tree.collections);
  }
  return (key) => {
    if (known.has(key)) return true;
    const names = parseNames(
      key.startsWith(CLOSED_PREFIX) ? key.slice(CLOSED_PREFIX.length) : key,
    );
    return names !== null && !read.has(names[0]!);
  };
}

/** The names of a {@link nodeKey}; `null` for a key that is none. */
function parseNames(key: string): string[] | null {
  try {
    const names: unknown = JSON.parse(key);
    return Array.isArray(names) &&
      names.length > 0 &&
      names.every((name) => typeof name === "string")
      ? names
      : null;
  } catch {
    return null;
  }
}
