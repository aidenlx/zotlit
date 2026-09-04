// The citekey resolution snapshot: a native citekey's Items, and an Item's native citekey, kept in memory.

import type { LibraryCitekey } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { getLogger } from "@/lib/log";
import { mapsEqual } from "@/lib/maps-equal";

const logger = getLogger("citation-index");

/** One Zotero Item a native citation key names. */
export interface SnapshotItem {
  itemID: number;
  /** Local id of the Library holding the Item, which names that Library. */
  libraryID: number;
  /** Bare Zotero item key — unique only within one Library. */
  key: string;
  /** The Item's exact identity across every Library. */
  indexedKey: string;
}

/**
 * What one Citation Key names in the current Library Scope. A key several
 * Items answer to is Ambiguous: the snapshot reports every candidate rather
 * than picking a Library or a first row.
 */
export type CitekeyResolution =
  | { kind: "missing" }
  | { kind: "unique"; item: SnapshotItem }
  /** Candidates in canonical Library order, then by ascending `itemID`. */
  | { kind: "ambiguous"; candidates: readonly SnapshotItem[] };

/** The bulk read a {@link CitekeySnapshot} rebuilds one Library from. */
export type ReadCitekeys = (
  db: NodeDatabaseClient,
  libraryID: number,
) => LibraryCitekey[];

/**
 * The Citation Index's resolution snapshot: which Zotero Items a native
 * citekey names, and back again. Rebuilt wholesale from one bulk read, never
 * mutated incrementally — the maps are small enough that replacing them is
 * cheaper than diffing.
 *
 * The two directions answer over different Libraries. Forward resolution
 * follows Library Scope, so narrowing the scope can leave one candidate and
 * make an Ambiguous Citation Key unique. The reverse lookup takes an exact
 * Indexed Key, which already names one Item across every local Library, so it
 * covers all of them and is scope-independent.
 */
export class CitekeySnapshot {
  #byCitekey = new Map<string, SnapshotItem[]>();
  #citekeyByIndexedKey = new Map<string, string>();

  /** Builds a complete snapshot from one canonical bulk read. */
  static from(
    rows: readonly LibraryCitekey[],
    inScope: ReadonlySet<number>,
  ): CitekeySnapshot {
    const snapshot = new CitekeySnapshot();
    snapshot.#replace(rows, inScope);
    return snapshot;
  }

  /** The Items a native citation key names, in the current Library Scope. */
  resolve(citekey: string): CitekeyResolution {
    const candidates = this.#byCitekey.get(citekey);
    if (!candidates || candidates.length === 0) return { kind: "missing" };
    if (candidates.length === 1)
      return { kind: "unique", item: candidates[0]! };
    return { kind: "ambiguous", candidates };
  }

  /** The native citation key of an Item, or null when it carries none. */
  citekeyOf(indexedKey: string): string | null {
    return this.#citekeyByIndexedKey.get(indexedKey) ?? null;
  }

  /** Builds both lookup directions from one fresh bulk read. */
  #replace(
    rows: readonly LibraryCitekey[],
    inScope: ReadonlySet<number>,
  ): void {
    const byCitekey = new Map<string, SnapshotItem[]>();
    const citekeyByIndexedKey = new Map<string, string>();
    for (const row of rows) {
      citekeyByIndexedKey.set(row.indexedKey, row.citekey);
      if (!inScope.has(row.libraryID)) continue;
      const item: SnapshotItem = {
        itemID: row.itemID,
        libraryID: row.libraryID,
        key: row.key,
        indexedKey: row.indexedKey,
      };
      const candidates = byCitekey.get(row.citekey);
      if (candidates) candidates.push(item);
      else byCitekey.set(row.citekey, [item]);
    }
    for (const [citekey, candidates] of byCitekey) {
      if (candidates.length > 1) {
        logger.debug("Ambiguous citation key in library scope", {
          citekey,
          candidates: candidates.length,
        });
      }
    }

    this.#byCitekey = byCitekey;
    this.#citekeyByIndexedKey = citekeyByIndexedKey;
  }

  /** Whether both lookup directions answer identically. */
  sameAs(other: CitekeySnapshot): boolean {
    return (
      mapsEqual(this.#byCitekey, other.#byCitekey, candidatesEqual) &&
      mapsEqual(
        this.#citekeyByIndexedKey,
        other.#citekeyByIndexedKey,
        (a, b) => a === b,
      )
    );
  }
}

/** Candidate membership and order both count, so either change is a change. */
function candidatesEqual(
  a: readonly SnapshotItem[],
  b: readonly SnapshotItem[],
): boolean {
  return (
    a.length === b.length && a.every((item, at) => itemEqual(item, b[at]!))
  );
}

function itemEqual(a: SnapshotItem, b: SnapshotItem): boolean {
  return (
    a.itemID === b.itemID &&
    a.libraryID === b.libraryID &&
    a.key === b.key &&
    a.indexedKey === b.indexedKey
  );
}
