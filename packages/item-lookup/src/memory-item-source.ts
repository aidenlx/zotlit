// An in-memory ItemSource with the controls an Item Index test drives.
import { Effect, Layer, PubSub, Stream } from "effect";

import type { IndexedItem, IndexSignature, Item } from "@zotlit/db";

import { ItemSource, SourceUnavailable } from "./item-index";
import type { PinnedItemSource } from "./item-index";
import { makeGate } from "./make-gate";

/** How often the Item Index read each part of an {@link ItemSource}. */
export interface MemoryItemSourceReads {
  pinned: number;
  itemIDs: number;
  items: number;
  signature: number;
  itemsByIndexedKey: number;
  /** `items` reads interrupted while held at the gate. */
  interrupted: number;
  /**
   * Pinned sources whose scope closed. A held index keeps the source it was
   * built on, so a finished build or re-check releases the source it
   * replaces; an interrupted or failed one releases its own.
   */
  released: number;
}

/** One Item of a {@link MemoryItemSource}: the row a build reads and the Item hydration reads. */
export interface MemoryItemRow {
  readonly indexed: IndexedItem;
  readonly item: Item;
}

/**
 * An {@link ItemSource} over a Map of rows per Library, with controls for a
 * test: replace rows, swap the source, emit a generation, fail the source, and
 * hold `items` at a gate mid-build.
 */
export interface MemoryItemSource {
  readonly layer: Layer.Layer<ItemSource>;
  /** Read counts since the source was made. */
  readonly reads: Readonly<MemoryItemSourceReads>;
  /** The generation the next pinned source reports. */
  readonly generation: number;
  /** Replace the rows of one Library. No generation is emitted. */
  readonly setItems: (
    libraryID: number,
    items: readonly MemoryItemRow[],
  ) => Effect.Effect<void>;
  /**
   * Make the Item of `indexedKey` vanish from every pinned source's
   * `itemsByIndexedKey`, as a delete with no change event does. No generation
   * is emitted and builds still read its row.
   */
  readonly vanish: (indexedKey: string) => Effect.Effect<void>;
  /** Emit a change on an unswapped source. */
  readonly notify: Effect.Effect<void>;
  /** Raise the generation and emit a change, as a swap of the source does. */
  readonly swap: Effect.Effect<void>;
  /** Make every later read fail with {@link SourceUnavailable}, or recover. */
  readonly setUnavailable: (unavailable: boolean) => Effect.Effect<void>;
  /** Hold every later `items` read until {@link MemoryItemSource.openGate}. */
  readonly closeGate: Effect.Effect<void>;
  readonly openGate: Effect.Effect<void>;
  /** Wait until an `items` read is held at the closed gate. */
  readonly held: Effect.Effect<void>;
  /** `items` reads held at the gate now. */
  readonly waiting: number;
  /**
   * Hold the next `itemsByIndexedKey` read until
   * {@link MemoryItemSource.openHydrationGate}; later reads pass.
   */
  readonly closeHydrationGate: Effect.Effect<void>;
  readonly openHydrationGate: Effect.Effect<void>;
  /** Wait until an `itemsByIndexedKey` read is held at the closed gate. */
  readonly hydrationHeld: Effect.Effect<void>;
  /**
   * Run `run` once, in the closing fiber, when the next pinned source closes.
   * A finished build closes the source of the index it replaces, so `run`
   * lands at the end of that build.
   */
  readonly onNextRelease: (run: Effect.Effect<void>) => Effect.Effect<void>;
}

/** `rows` holds the Items of each Library; ids come back newest first. */
export const makeMemoryItemSource = (
  rows: ReadonlyMap<number, readonly MemoryItemRow[]>,
): Effect.Effect<MemoryItemSource> =>
  Effect.gen(function* () {
    const libraries = new Map(rows);
    const reads: MemoryItemSourceReads = {
      pinned: 0,
      itemIDs: 0,
      items: 0,
      signature: 0,
      itemsByIndexedKey: 0,
      interrupted: 0,
      released: 0,
    };
    let generation = 0;
    let unavailable = false;
    let waiting = 0;
    let onRelease: Effect.Effect<void> | null = null;
    const vanished = new Set<string>();
    const hydrationGate = yield* makeGate({ once: true });
    const generations = yield* PubSub.unbounded<void>();
    const gate = yield* makeGate();

    const check = Effect.suspend(() =>
      unavailable
        ? Effect.fail(new SourceUnavailable({ message: "source unavailable" }))
        : Effect.void,
    );

    const pinnedTo = (state: ReadonlyMap<number, readonly MemoryItemRow[]>) => {
      const rowsOf = [...state.values()].flat();
      const byId = new Map(rowsOf.map((row) => [row.indexed.itemID, row]));
      const byIndexedKey = new Map(
        rowsOf.map((row) => [row.indexed.indexedKey, row.item]),
      );
      const source: PinnedItemSource = {
        generation,
        itemIDs: (libraryID) =>
          check.pipe(
            Effect.map(() => {
              reads.itemIDs++;
              return newestFirst(state.get(libraryID) ?? []).map(
                (row) => row.indexed.itemID,
              );
            }),
          ),
        items: (itemIDs) =>
          check.pipe(
            Effect.andThen(
              Effect.suspend(() => {
                reads.items++;
                if (!gate.closed) return Effect.void;
                waiting++;
                return gate.pass.pipe(
                  Effect.onInterrupt(() =>
                    Effect.sync(() => {
                      reads.interrupted++;
                    }),
                  ),
                  Effect.ensuring(
                    Effect.sync(() => {
                      waiting--;
                    }),
                  ),
                );
              }),
            ),
            Effect.andThen(check),
            Effect.map(() =>
              itemIDs.flatMap((itemID) => {
                const row = byId.get(itemID);
                return row ? [row.indexed] : [];
              }),
            ),
          ),
        signature: (libraryID) =>
          check.pipe(
            Effect.map(() => {
              reads.signature++;
              return signatureOf(state.get(libraryID) ?? []);
            }),
          ),
        itemsByIndexedKey: (indexedKeys) =>
          check.pipe(
            Effect.andThen(hydrationGate.pass),
            Effect.map(() => {
              reads.itemsByIndexedKey++;
              const found = new Map<string, Item>();
              for (const indexedKey of indexedKeys) {
                const item = vanished.has(indexedKey)
                  ? undefined
                  : byIndexedKey.get(indexedKey);
                if (item) found.set(indexedKey, item);
              }
              return found;
            }),
          ),
      };
      return source;
    };

    const layer = Layer.succeed(ItemSource, {
      generation: Stream.fromPubSub(generations),
      pinned: Effect.acquireRelease(
        check.pipe(
          Effect.map(() => {
            reads.pinned++;
            return pinnedTo(new Map(libraries));
          }),
        ),
        () =>
          Effect.suspend(() => {
            reads.released++;
            const run = onRelease;
            onRelease = null;
            return run ?? Effect.void;
          }),
      ),
    });

    return {
      layer,
      reads,
      get generation() {
        return generation;
      },
      get waiting() {
        return waiting;
      },
      setItems: (libraryID, items) =>
        Effect.sync(() => {
          libraries.set(libraryID, items);
        }),
      vanish: (indexedKey) =>
        Effect.sync(() => {
          vanished.add(indexedKey);
        }),
      notify: PubSub.publish(generations, undefined).pipe(Effect.asVoid),
      swap: Effect.suspend(() => {
        generation++;
        return PubSub.publish(generations, undefined);
      }).pipe(Effect.asVoid),
      setUnavailable: (value) =>
        Effect.sync(() => {
          unavailable = value;
        }),
      closeGate: gate.close,
      openGate: gate.open,
      held: gate.held,
      closeHydrationGate: hydrationGate.close,
      openHydrationGate: hydrationGate.open,
      hydrationHeld: hydrationGate.held,
      onNextRelease: (run) =>
        Effect.sync(() => {
          onRelease = run;
        }),
    } satisfies MemoryItemSource;
  });

function newestFirst(rows: readonly MemoryItemRow[]): MemoryItemRow[] {
  return rows.toSorted(
    (a, b) =>
      Temporal.Instant.compare(
        b.indexed.dateModified,
        a.indexed.dateModified,
      ) || a.indexed.itemID - b.indexed.itemID,
  );
}

/** The same `(count, checksum)` shape the database signature query reads. */
function signatureOf(rows: readonly MemoryItemRow[]): IndexSignature {
  return {
    count: rows.length,
    checksum: rows.reduce(
      (sum, { indexed }) =>
        sum +
        Math.floor(indexed.dateModified.epochMilliseconds / 1000) +
        indexed.itemID,
      0,
    ),
  };
}
