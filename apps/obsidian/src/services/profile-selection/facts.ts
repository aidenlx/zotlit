// The database side of Profile Selection Rules: Item membership facts and the Collection paths the editor offers.
import {
  getCollectionIDsByItem,
  getCollectionNodesByLibrary,
  resolveItemTags,
} from "@zotlit/db";
import type { CollectionNode, Item } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import type { AvailableLibrary } from "@/services/library-scope/scope";

import type { MatchItemFacts } from "./condition";

/** One Collection the editor offers, with the words it is shown by. */
export interface CollectionChoice {
  /** Root-to-leaf Collection names, this Collection last. */
  path: readonly string[];
}

/**
 * The Item's actual memberships: every Tag name and each direct Collection's
 * root-first path.
 */
export function resolveMembershipFacts(
  client: NodeDatabaseClient,
  item: Pick<Item, "itemID" | "libraryID">,
): Pick<MatchItemFacts, "tags" | "collections"> {
  const tags = resolveItemTags(client, item.itemID, new Map()).map(
    ({ tag }) => tag.name,
  );
  const nodes = nodeMap(getCollectionNodesByLibrary(client, item.libraryID));
  const collections: string[][] = [];
  for (const collectionID of getCollectionIDsByItem(client, item.itemID)) {
    const node = nodes.get(collectionID);
    if (!node) continue;
    collections.push(
      [...ancestorsOf(node, nodes).toReversed(), node].map(
        ({ collectionName }) => collectionName,
      ),
    );
  }
  return { tags, collections };
}

/**
 * Every distinct live Collection path across the given Libraries, sorted.
 */
export function listCollectionChoices(
  client: NodeDatabaseClient,
  libraries: readonly AvailableLibrary[],
): CollectionChoice[] {
  const byPath = new Map<string, CollectionChoice>();
  for (const { libraryID } of libraries) {
    for (const choice of libraryChoices(
      getCollectionNodesByLibrary(client, libraryID),
    ))
      byPath.set(choice.path.join("/"), choice);
  }
  return [...byPath.values()].sort((a, b) => comparePaths(a.path, b.path));
}

function libraryChoices(rows: readonly CollectionNode[]): CollectionChoice[] {
  const nodes = nodeMap(rows);
  return [...nodes.values()]
    .map((node) => ({
      path: [...ancestorsOf(node, nodes).toReversed(), node].map(
        ({ collectionName }) => collectionName,
      ),
    }))
    .sort((a, b) => comparePaths(a.path, b.path));
}

function nodeMap(
  rows: readonly CollectionNode[],
): ReadonlyMap<number, CollectionNode> {
  return new Map(rows.map((row) => [row.collectionID, row]));
}

/**
 * The live ancestors of a node, nearest first. A parent absent from `nodes`
 * (trashed) ends the chain, as Zotero's Collection tree hides it.
 */
function ancestorsOf(
  node: CollectionNode,
  nodes: ReadonlyMap<number, CollectionNode>,
): CollectionNode[] {
  const parentOf = (child: CollectionNode) =>
    child.parentCollectionID === null
      ? undefined
      : nodes.get(child.parentCollectionID);
  const chain: CollectionNode[] = [];
  let parent = parentOf(node);
  while (parent) {
    chain.push(parent);
    parent = parentOf(parent);
  }
  return chain;
}

function comparePaths(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = a[i]!.localeCompare(b[i]!);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}
