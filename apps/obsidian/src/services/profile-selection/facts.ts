// The database side of Profile Selection Rules: the membership facts a rule reads of an Item, whether a referenced Collection exists, and the Collections the editor offers.
//
// Every Collection reference is portable — a Library selector plus Zotero's
// Collection key — and local `libraryID`s are resolved here, per database
// snapshot, so the same rule means the same thing on every device.
import {
  getCollectionIDsByItem,
  getCollectionNodesByLibrary,
  getLibraries,
  resolveItemTags,
} from "@zotlit/db";
import type { CollectionNode, Item } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { selectorKey, selectorOf } from "@/services/library-scope/scope";
import type {
  AvailableLibrary,
  LibrarySelector,
} from "@/services/library-scope/scope";

import type { CollectionReference, RuleItemFacts } from "./condition";

/** One Collection the editor offers, with the words it is shown by. */
export interface CollectionChoice extends CollectionReference {
  /** Root-to-leaf Collection names, this Collection last. */
  path: readonly string[];
}

/**
 * The Item's actual memberships: every Tag name applied to it, the keys of
 * the Collections it is filed in, and the keys of their live ancestors.
 */
export function resolveMembershipFacts(
  client: NodeDatabaseClient,
  item: Pick<Item, "itemID" | "libraryID">,
): Pick<RuleItemFacts, "tags" | "collections" | "collectionAncestors"> {
  const tags = resolveItemTags(client, item.itemID, new Map()).map(
    ({ tag }) => tag.name,
  );
  const nodes = nodeMap(getCollectionNodesByLibrary(client, item.libraryID));
  const collections: string[] = [];
  const ancestors = new Set<string>();
  for (const collectionID of getCollectionIDsByItem(client, item.itemID)) {
    const node = nodes.get(collectionID);
    if (!node) continue;
    collections.push(node.key);
    for (const ancestor of ancestorsOf(node, nodes))
      ancestors.add(ancestor.key);
  }
  return { tags, collections, collectionAncestors: [...ancestors] };
}

/**
 * Whether the database holds a referenced Collection — the check that keeps
 * a stale or foreign reference a broken rule rather than a nonmatch.
 */
export function collectionLookup(
  client: NodeDatabaseClient,
): (reference: CollectionReference) => boolean {
  const libraryIDs = new Map(
    getLibraries(client).flatMap((library) => {
      const selector = selectorOf(library);
      return selector ? [[selectorKey(selector), library.libraryID]] : [];
    }),
  );
  const keysByLibrary = new Map<number, Set<string>>();
  return ({ library, key }) => {
    const libraryID = libraryIDs.get(selectorKey(library));
    if (libraryID === undefined) return false;
    let keys = keysByLibrary.get(libraryID);
    if (!keys) {
      keys = new Set(
        getCollectionNodesByLibrary(client, libraryID).map((node) => node.key),
      );
      keysByLibrary.set(libraryID, keys);
    }
    return keys.has(key);
  };
}

/** The existence check {@link collectionLookup} makes, over listed choices. */
export function choicesLookup(
  choices: readonly CollectionChoice[],
): (reference: CollectionReference) => boolean {
  const known = new Set(
    choices.map(({ library, key }) => `${selectorKey(library)}/${key}`),
  );
  return ({ library, key }) => known.has(`${selectorKey(library)}/${key}`);
}

/**
 * Every live Collection of the given Libraries, in Library order and then by
 * path, for the editor's Collection selector.
 */
export function listCollectionChoices(
  client: NodeDatabaseClient,
  libraries: readonly AvailableLibrary[],
): CollectionChoice[] {
  return libraries.flatMap(({ selector, libraryID }) =>
    libraryChoices(selector, getCollectionNodesByLibrary(client, libraryID)),
  );
}

function libraryChoices(
  library: LibrarySelector,
  rows: readonly CollectionNode[],
): CollectionChoice[] {
  const nodes = nodeMap(rows);
  return [...nodes.values()]
    .map((node) => ({
      library,
      key: node.key,
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
  const chain: CollectionNode[] = [];
  for (
    let parent =
      node.parentCollectionID === null
        ? undefined
        : nodes.get(node.parentCollectionID);
    parent;
    parent =
      parent.parentCollectionID === null
        ? undefined
        : nodes.get(parent.parentCollectionID)
  )
    chain.push(parent);
  return chain;
}

function comparePaths(a: readonly string[], b: readonly string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = a[i]!.localeCompare(b[i]!);
    if (order !== 0) return order;
  }
  return a.length - b.length;
}
