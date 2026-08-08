// The citekey resolution snapshot: a native citekey's Item, and an Item's native citekey, kept in memory.

import type { LibraryCitekey } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { getLogger } from "@/lib/log";

const logger = getLogger("citation-index");

/** The Zotero Item a native citation key names. */
export interface SnapshotItem {
  itemID: number;
  indexedKey: string;
}

/** The bulk read {@link CitekeySnapshot.replace} rebuilds from. */
export type ReadCitekeys = (
  db: NodeDatabaseClient,
  libraryID: number,
) => LibraryCitekey[];

/**
 * The Citation Index's resolution snapshot: which native citekey names which
 * Zotero Item, and back again. Rebuilt wholesale from one bulk read, never
 * mutated incrementally — the maps are small enough that replacing them is
 * cheaper than diffing.
 */
export class CitekeySnapshot {
  #byCitekey = new Map<string, SnapshotItem>();
  #citekeyByIndexedKey = new Map<string, string>();

  /** The Item a native citation key names, or null when none does. */
  byCitekey(citekey: string): SnapshotItem | null {
    return this.#byCitekey.get(citekey) ?? null;
  }

  /** The native citation key of an Item, or null when it carries none. */
  citekeyOf(indexedKey: string): string | null {
    return this.#citekeyByIndexedKey.get(indexedKey) ?? null;
  }

  /**
   * Replace the maps with the rows of a fresh bulk read. The forward map is
   * first-wins: when two rows share one citekey, it keeps the first in
   * `rows`' own order and drops the rest, logged at `debug` by the citekey
   * they lost. The reverse map holds every Item's own citekey regardless —
   * `indexedKey` is unique per row, so each Item's entry is recorded even
   * when its citekey lost the forward map to another Item.
   *
   * @returns whether what the maps answer changed.
   */
  replace(rows: readonly LibraryCitekey[]): boolean {
    const byCitekey = new Map<string, SnapshotItem>();
    const citekeyByIndexedKey = new Map<string, string>();
    for (const row of rows) {
      if (byCitekey.has(row.citekey)) {
        logger.debug("Duplicate citekey dropped from resolution snapshot", {
          citekey: row.citekey,
        });
      } else {
        byCitekey.set(row.citekey, {
          itemID: row.itemID,
          indexedKey: row.indexedKey,
        });
      }
      citekeyByIndexedKey.set(row.indexedKey, row.citekey);
    }

    const changed =
      !mapsEqual(this.#byCitekey, byCitekey, itemEqual) ||
      !mapsEqual(
        this.#citekeyByIndexedKey,
        citekeyByIndexedKey,
        (a, b) => a === b,
      );
    this.#byCitekey = byCitekey;
    this.#citekeyByIndexedKey = citekeyByIndexedKey;
    return changed;
  }
}

function itemEqual(a: SnapshotItem, b: SnapshotItem): boolean {
  return a.itemID === b.itemID && a.indexedKey === b.indexedKey;
}

function mapsEqual<K, V>(
  a: ReadonlyMap<K, V>,
  b: ReadonlyMap<K, V>,
  valueEqual: (a: V, b: V) => boolean,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (other === undefined || !valueEqual(value, other)) return false;
  }
  return true;
}
