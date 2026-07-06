import { type NodeDatabaseClient } from "@/client/node";
import { type QueryRow } from "@/queries/_shared";
import {
  collectionIDsByItemQuery,
  collectionNodesByLibraryQuery,
} from "@/queries/collections";

import { defineToString } from "./to-string";

/**
 * A Zotero collection an item belongs to, in the template vocabulary. Coerces
 * to `name` in string contexts (like a tag coerces to its name).
 */
export interface TemplateCollection {
  key: string;
  name: string;
  /**
   * Ancestor chain from top-level root to this collection: `path[0]` is the
   * top-level ancestor, `path[path.length - 1]` is this collection. A plain
   * array — render with `path.join(" > ")` (or `"/"` for filename folders).
   */
  path: readonly string[];
}

type CollectionNodeRow = QueryRow<typeof collectionNodesByLibraryQuery>;

/** Internal node form: the nodes-query row with Zotero column names normalized. */
interface CollectionNode {
  collectionID: number;
  name: string;
  key: string;
  parentID: number | null;
}

function toNodeMap(
  rows: readonly CollectionNodeRow[],
): ReadonlyMap<number, CollectionNode> {
  return new Map(
    rows.map((row) => [
      row.collectionID,
      {
        collectionID: row.collectionID,
        name: row.collectionName,
        key: row.key,
        parentID: row.parentCollectionID,
      },
    ]),
  );
}

const byName = (a: TemplateCollection, b: TemplateCollection): number =>
  a.name.localeCompare(b.name);

/**
 * Per-batch memo for resolving an item's collections into `TemplateCollection` objects.
 * Owns four things so the cost stays cheap across a batch:
 *
 * 1. A lazy per-library bulk load of every non-trashed collection node,
 *    cached so each library loads once.
 * 2. A resolved-path cache keyed by the globally-unique `collectionID`, so a
 *    shared ancestor's path is built once.
 * 3. The in-memory ancestor walk, which truncates at the first parent absent
 *    from the node set (a live collection under a trashed parent roots there).
 * 4. An itemID-level result cache, so a repeat `byItemIDs` call for the same
 *    itemID within this instance's lifetime skips the membership query too.
 *
 * Hold one instance across a batch (like a `GroupIDMemo`); discard per single op.
 * @see collectionNodesByLibraryQuery
 */
export class CollectionCache {
  readonly #nodesByLibrary = new Map<
    number,
    ReadonlyMap<number, CollectionNode>
  >();
  readonly #resolved = new Map<number, TemplateCollection>();
  readonly #byItem = new Map<number, TemplateCollection[]>();

  /** Resolve each item's collections, sorted by name within each item. */
  byItemIDs(
    db: NodeDatabaseClient,
    libraryID: number,
    itemIDs: readonly number[],
  ): Map<number, TemplateCollection[]> {
    const nodes = this.#nodes(db, libraryID);
    const result = new Map<number, TemplateCollection[]>();
    for (const itemID of itemIDs) {
      const cached = this.#byItem.get(itemID);
      if (cached) {
        result.set(itemID, cached);
        continue;
      }
      const rows = collectionIDsByItemQuery.prepared(db).all({ itemID });
      const collections = this.#resolveItem(rows, nodes);
      this.#byItem.set(itemID, collections);
      result.set(itemID, collections);
    }
    return result;
  }

  #resolveItem(
    rows: readonly { collectionID: number }[],
    nodes: ReadonlyMap<number, CollectionNode>,
  ): TemplateCollection[] {
    const collections: TemplateCollection[] = [];
    for (const { collectionID } of rows) {
      const resolved = this.#resolvePath(collectionID, nodes);
      if (resolved) collections.push(resolved);
    }
    return collections.toSorted(byName);
  }

  #nodes(
    db: NodeDatabaseClient,
    libraryID: number,
  ): ReadonlyMap<number, CollectionNode> {
    return (
      this.#nodesByLibrary.get(libraryID) ??
      this.#storeNodes(
        libraryID,
        collectionNodesByLibraryQuery.prepared(db).all({ libraryID }),
      )
    );
  }

  #storeNodes(
    libraryID: number,
    rows: readonly CollectionNodeRow[],
  ): ReadonlyMap<number, CollectionNode> {
    const nodes = toNodeMap(rows);
    this.#nodesByLibrary.set(libraryID, nodes);
    return nodes;
  }

  /**
   * Walk ancestors to build the root→leaf path, memoizing per collectionID.
   * A `parentID` absent from `nodes` (its parent is trashed) truncates the path,
   * rooting it at the first live node — never throwing, never including the
   * trashed parent.
   *
   * The recursion needs no cycle guard: Zotero rejects reparenting a collection
   * into itself or any of its own descendants, so `parentCollectionID` is always
   * an acyclic tree and the walk terminates at a `null` or trashed parent.
   * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/data/collection.js#L250-L283 throws
   *   "Cannot move collection into itself!" and "into one of its own descendents".
   * @returns `undefined` when the collection itself is absent from `nodes` (trashed).
   */
  #resolvePath(
    collectionID: number,
    nodes: ReadonlyMap<number, CollectionNode>,
  ): TemplateCollection | undefined {
    const memoized = this.#resolved.get(collectionID);
    if (memoized) return memoized;

    const node = nodes.get(collectionID);
    if (!node) return undefined;

    const parentPath =
      node.parentID == null
        ? []
        : (this.#resolvePath(node.parentID, nodes)?.path ?? []);
    const collection = defineToString(
      { key: node.key, name: node.name, path: [...parentPath, node.name] },
      function () {
        return this.name;
      },
    );
    this.#resolved.set(collectionID, collection);
    return collection;
  }
}
