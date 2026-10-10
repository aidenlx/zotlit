// Worker-owned citation maps: a native citekey's Items, and an Item's native citekey.
import { Effect, Stream } from "effect";

import type { LibraryCitekey } from "@zotlit/db";

import { getLogger } from "@/lib/log";

const logger = getLogger("citation-index");
const SNAPSHOT_SLICE_MS = 4;

/** Construction and comparison share one worker work budget. */
class SnapshotWork {
  #deadline = performance.now() + SNAPSHOT_SLICE_MS;
  #steps = 0;

  /** Check in small batches without creating an Effect for every row. */
  step(): Effect.Effect<void> | undefined {
    if (++this.#steps % 128 !== 0) return;
    if (performance.now() >= this.#deadline) return this.#pause;
  }

  readonly #pause = Effect.map(Effect.yieldNow, () => {
    this.#deadline = performance.now() + SNAPSHOT_SLICE_MS;
  });
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
 * Complete worker-owned maps: which Zotero Items a native citekey names,
 * and back again. Rebuilt from one pinned connection and never mutated after
 * publication. Construction and comparison yield in small worker slices.
 * Callers receive only the requested projections through CitationLookup.
 *
 * The two directions answer over different Libraries. Forward resolution
 * follows Library Scope, so narrowing the scope can leave one candidate and
 * make an Ambiguous Citation Key unique. The reverse lookup takes an exact
 * Indexed Key, which already names one Item across every local Library, so it
 * covers all of them and is scope-independent.
 */
export class CitekeySnapshot {
  readonly #byCitekey = new Map<string, SnapshotItem[]>();
  readonly #citekeyByIndexedKey = new Map<string, string>();

  /** Builds a complete snapshot, retaining `previous` when its answers match. */
  static from = Effect.fnUntraced(function* <E, R>(
    rows: Stream.Stream<LibraryCitekey, E, R>,
    // Iteration order is the canonical Library order.
    inScope: ReadonlySet<number>,
    { previous }: { previous?: CitekeySnapshot } = {},
  ): Effect.fn.Return<CitekeySnapshot, E, R> {
    const libraryOrder = new Map([...inScope].map((id, index) => [id, index]));
    const work = new SnapshotWork();
    const snapshot = new CitekeySnapshot();
    const byCitekey = snapshot.#byCitekey;
    const citekeyByIndexedKey = snapshot.#citekeyByIndexedKey;
    yield* Stream.runForEachArray(
      rows,
      Effect.fnUntraced(function* (page) {
        for (const row of page) {
          const pause = work.step();
          if (pause) yield* pause;
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
      }),
    );
    for (const [citekey, candidates] of byCitekey) {
      const pause = work.step();
      if (pause) yield* pause;
      if (candidates.length > 1) {
        candidates.sort(
          (a, b) =>
            libraryOrder.get(a.libraryID)! - libraryOrder.get(b.libraryID)! ||
            a.itemID - b.itemID,
        );
        logger.debug("Ambiguous citation key in library scope", {
          citekey,
          candidates: candidates.length,
        });
      }
    }

    const unchanged =
      previous && (yield* CitekeySnapshot.#sameAs(snapshot, previous, work));
    if (unchanged) return previous;
    return snapshot;
  });

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

  /** Whether both lookup directions answer identically. */
  static readonly #sameAs = Effect.fnUntraced(function* (
    snapshot: CitekeySnapshot,
    other: CitekeySnapshot,
    work: SnapshotWork,
  ) {
    if (
      snapshot.#byCitekey.size !== other.#byCitekey.size ||
      snapshot.#citekeyByIndexedKey.size !== other.#citekeyByIndexedKey.size
    )
      return false;
    for (const [key, candidates] of snapshot.#byCitekey) {
      const previous = other.#byCitekey.get(key);
      if (!previous || candidates.length !== previous.length) return false;
      for (let at = 0; at < candidates.length; at += 1) {
        const pause = work.step();
        if (pause) yield* pause;
        if (!itemEqual(candidates[at]!, previous[at]!)) return false;
      }
    }
    for (const [key, citekey] of snapshot.#citekeyByIndexedKey) {
      const pause = work.step();
      if (pause) yield* pause;
      if (other.#citekeyByIndexedKey.get(key) !== citekey) return false;
    }
    return true;
  });
}

function itemEqual(a: SnapshotItem, b: SnapshotItem): boolean {
  return (
    a.itemID === b.itemID &&
    a.libraryID === b.libraryID &&
    a.key === b.key &&
    a.indexedKey === b.indexedKey
  );
}
