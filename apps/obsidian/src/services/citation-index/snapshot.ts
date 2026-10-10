// The citekey resolution snapshot: a native citekey's Items, and an Item's native citekey, kept in memory.

import type { LibraryCitekey } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import { yieldToMain } from "@/lib/yield-to-main";

const logger = getLogger("citation-index");
const SNAPSHOT_SLICE_MS = 4;

/** Construction and comparison share one renderer work budget. */
class SnapshotWork {
  readonly #signal;
  #deadline = performance.now() + SNAPSHOT_SLICE_MS;
  #steps = 0;

  constructor(signal?: AbortSignal) {
    this.#signal = signal;
    signal?.throwIfAborted();
  }

  /** Check in small batches without creating a Promise for every row. */
  step(): Promise<void> | undefined {
    if (++this.#steps % 128 !== 0) return;
    this.#signal?.throwIfAborted();
    if (performance.now() >= this.#deadline) return this.#pause();
  }

  async #pause(): Promise<void> {
    await yieldToMain();
    this.#signal?.throwIfAborted();
    this.#deadline = performance.now() + SNAPSHOT_SLICE_MS;
  }
}

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

/**
 * The Citation Index's resolution snapshot: which Zotero Items a native
 * citekey names, and back again. Rebuilt wholesale from one bulk read, never
 * mutated after publication. Construction and comparison yield in small
 * slices while callers keep using the previous complete snapshot.
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

  /** Builds a complete snapshot, retaining `previous` when its answers match. */
  static async from(
    rows: Iterable<LibraryCitekey>,
    inScope: ReadonlySet<number>,
    {
      previous,
      signal,
    }: { previous?: CitekeySnapshot; signal?: AbortSignal } = {},
  ): Promise<CitekeySnapshot> {
    const work = new SnapshotWork(signal);
    const snapshot = new CitekeySnapshot();
    await snapshot.#replace(rows, inScope, work);
    const unchanged = previous && (await snapshot.#sameAs(previous, work));
    signal?.throwIfAborted();
    if (unchanged) return previous;
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
  async #replace(
    rows: Iterable<LibraryCitekey>,
    inScope: ReadonlySet<number>,
    work: SnapshotWork,
  ): Promise<void> {
    const byCitekey = new Map<string, SnapshotItem[]>();
    const citekeyByIndexedKey = new Map<string, string>();
    for (const row of rows) {
      const pause = work.step();
      if (pause) await pause;
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
      const pause = work.step();
      if (pause) await pause;
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
  async #sameAs(other: CitekeySnapshot, work: SnapshotWork): Promise<boolean> {
    if (
      this.#byCitekey.size !== other.#byCitekey.size ||
      this.#citekeyByIndexedKey.size !== other.#citekeyByIndexedKey.size
    )
      return false;
    for (const [key, candidates] of this.#byCitekey) {
      const previous = other.#byCitekey.get(key);
      if (!previous || candidates.length !== previous.length) return false;
      for (let at = 0; at < candidates.length; at += 1) {
        const pause = work.step();
        if (pause) await pause;
        if (!itemEqual(candidates[at]!, previous[at]!)) return false;
      }
    }
    for (const [key, citekey] of this.#citekeyByIndexedKey) {
      const pause = work.step();
      if (pause) await pause;
      if (other.#citekeyByIndexedKey.get(key) !== citekey) return false;
    }
    return true;
  }
}

function itemEqual(a: SnapshotItem, b: SnapshotItem): boolean {
  return (
    a.itemID === b.itemID &&
    a.libraryID === b.libraryID &&
    a.key === b.key &&
    a.indexedKey === b.indexedKey
  );
}
