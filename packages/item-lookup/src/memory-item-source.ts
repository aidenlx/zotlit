import { Effect, Latch, Layer, PubSub, Stream } from "effect";

import type { IndexedItem, IndexSignature } from "@zotlit/db";

import { ItemSource, SourceUnavailable } from "./item-index";
import type { PinnedItemSource } from "./item-index";

/** How often the Item Index read each part of an {@link ItemSource}. */
export interface MemoryItemSourceReads {
  pinned: number;
  itemIDs: number;
  items: number;
  signature: number;
  /** `items` reads interrupted while held at the gate. */
  interrupted: number;
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
    items: readonly IndexedItem[],
  ) => Effect.Effect<void>;
  /** Emit the current generation, as a change on an unswapped source does. */
  readonly notify: Effect.Effect<void>;
  /** Raise the generation and emit it, as a swap of the source does. */
  readonly swap: Effect.Effect<void>;
  /** Make every later read fail with {@link SourceUnavailable}, or recover. */
  readonly setUnavailable: (unavailable: boolean) => Effect.Effect<void>;
  /** Hold every later `items` read until {@link MemoryItemSource.openGate}. */
  readonly closeGate: Effect.Effect<void>;
  readonly openGate: Effect.Effect<void>;
  /** Wait until an `items` read is held at the closed gate. */
  readonly held: Effect.Effect<void>;
}

/** `rows` holds the Items of each Library; ids come back newest first. */
export const makeMemoryItemSource = (
  rows: ReadonlyMap<number, readonly IndexedItem[]>,
): Effect.Effect<MemoryItemSource> =>
  Effect.gen(function* () {
    const libraries = new Map(rows);
    const reads: MemoryItemSourceReads = {
      pinned: 0,
      itemIDs: 0,
      items: 0,
      signature: 0,
      interrupted: 0,
    };
    let generation = 0;
    let unavailable = false;
    let gateClosed = false;
    const generations = yield* PubSub.unbounded<number>();
    const gate = yield* Latch.make(true);
    const arrived = yield* Latch.make(false);

    const check = Effect.suspend(() =>
      unavailable
        ? Effect.fail(new SourceUnavailable({ message: "source unavailable" }))
        : Effect.void,
    );

    const pinnedTo = (state: ReadonlyMap<number, readonly IndexedItem[]>) => {
      const byId = new Map(
        [...state.values()].flat().map((item) => [item.itemID, item]),
      );
      const source: PinnedItemSource = {
        generation,
        itemIDs: (libraryID) =>
          check.pipe(
            Effect.map(() => {
              reads.itemIDs++;
              return newestFirst(state.get(libraryID) ?? []).map(
                (item) => item.itemID,
              );
            }),
          ),
        items: (itemIDs) =>
          check.pipe(
            Effect.andThen(
              Effect.suspend(() => {
                reads.items++;
                return gateClosed
                  ? Effect.andThen(arrived.open, gate.await).pipe(
                      Effect.onInterrupt(() =>
                        Effect.sync(() => {
                          reads.interrupted++;
                        }),
                      ),
                    )
                  : Effect.void;
              }),
            ),
            Effect.andThen(check),
            Effect.map(() =>
              itemIDs.flatMap((itemID) => {
                const item = byId.get(itemID);
                return item ? [item] : [];
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
      };
      return source;
    };

    const layer = Layer.succeed(ItemSource, {
      generation: Stream.fromPubSub(generations),
      pinned: check.pipe(
        Effect.map(() => {
          reads.pinned++;
          return pinnedTo(new Map(libraries));
        }),
      ),
    });

    return {
      layer,
      reads,
      get generation() {
        return generation;
      },
      setItems: (libraryID, items) =>
        Effect.sync(() => {
          libraries.set(libraryID, items);
        }),
      notify: Effect.suspend(() =>
        PubSub.publish(generations, generation),
      ).pipe(Effect.asVoid),
      swap: Effect.suspend(() => {
        generation++;
        return PubSub.publish(generations, generation);
      }).pipe(Effect.asVoid),
      setUnavailable: (value) =>
        Effect.sync(() => {
          unavailable = value;
        }),
      closeGate: Effect.suspend(() => {
        gateClosed = true;
        return Effect.andThen(gate.close, arrived.close);
      }).pipe(Effect.asVoid),
      openGate: Effect.suspend(() => {
        gateClosed = false;
        return gate.open;
      }).pipe(Effect.asVoid),
      held: arrived.await,
    } satisfies MemoryItemSource;
  });

function newestFirst(items: readonly IndexedItem[]): IndexedItem[] {
  return items.toSorted(
    (a, b) =>
      Temporal.Instant.compare(b.dateModified, a.dateModified) ||
      a.itemID - b.itemID,
  );
}

/** The same `(count, checksum)` shape the database signature query reads. */
function signatureOf(items: readonly IndexedItem[]): IndexSignature {
  return {
    count: items.length,
    checksum: items.reduce(
      (sum, item) =>
        sum +
        Math.floor(item.dateModified.epochMilliseconds / 1000) +
        item.itemID,
      0,
    ),
  };
}
