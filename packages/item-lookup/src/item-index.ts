import { getLogger } from "@logtape/logtape";
/**
 * The Item Index: one search index per Library list, built from an
 * {@link ItemSource} and kept fresh by its generation stream.
 *
 * - The first search for a Library list waits for its build; later searches
 *   answer from the last complete index while a rebuild runs.
 * - Rebuilds of one list are single-flight with one trailing rerun: a request
 *   that arrives mid-build lets the build finish, then runs once more.
 * - A generation emission re-checks every held list. A changed generation, a
 *   changed configuration, or a moved signature vector rebuilds; an equal one
 *   keeps the index. A list no search asked for since the last emission, and
 *   that no search waits on, is evicted and its build interrupted.
 * - A build reads one pinned source for its whole life, in slices, and yields
 *   to the scheduler after each slice.
 * - A locale or Segmenter change in {@link IndexConfig} rebuilds every held
 *   list.
 */
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Layer,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import type { Scope } from "effect";

import { createLanguageLookup } from "@zotlit/db";
import type {
  IndexedItem,
  IndexSignature,
  LanguageNameLookup,
} from "@zotlit/db";

import { makeEngineIndexBuilder, searchEngineIndex } from "./engine";
import type { EngineIndex, ItemHit } from "./engine";
import { Segmenter } from "./segmenter";

/** The source behind an {@link ItemSource} cannot answer. */
export class SourceUnavailable extends Schema.TaggedError<SourceUnavailable>()(
  "SourceUnavailable",
  { message: Schema.String },
) {}

/** Reads bound to one state of the source, for the scope of one build. */
export interface PinnedItemSource {
  /** The generation of the source these reads are bound to. */
  readonly generation: number;
  /** Ids of the indexed Items of one Library, newest `dateModified` first. */
  readonly itemIDs: (
    libraryID: number,
  ) => Effect.Effect<readonly number[], SourceUnavailable>;
  /** The rows of a slice of ids, in request order; a vanished id is skipped. */
  readonly items: (
    itemIDs: readonly number[],
  ) => Effect.Effect<readonly IndexedItem[], SourceUnavailable>;
  /** The change signature of one Library's indexed Items. */
  readonly signature: (
    libraryID: number,
  ) => Effect.Effect<IndexSignature, SourceUnavailable>;
}

/** The port the Item Index reads Items through. */
export class ItemSource extends Context.Service<
  ItemSource,
  {
    /**
     * Emits the current generation each time the source may have changed. The
     * generation rises when the source behind the port is swapped. The stream
     * emits only changes after the subscription, never a replay of the current
     * state.
     */
    readonly generation: Stream.Stream<number>;
    /** A source bound to one state until the caller's scope closes. */
    readonly pinned: Effect.Effect<
      PinnedItemSource,
      SourceUnavailable,
      Scope.Scope
    >;
  }
>()("zotlit/item-lookup/ItemSource") {}

/** The settings an index is built with; a change rebuilds every held list. */
export class IndexConfig extends Context.Service<
  IndexConfig,
  {
    /** The UI locale, for creator-name language lookup; `null` for none. */
    readonly locale: SubscriptionRef.SubscriptionRef<string | null>;
    /** The word splitter for indexing and queries. */
    readonly segmenter: SubscriptionRef.SubscriptionRef<
      (typeof Segmenter)["Service"]
    >;
  }
>()("zotlit/item-lookup/IndexConfig") {}

/** An {@link IndexConfig} that starts with `locale` and the provided Segmenter. */
export const layerIndexConfig = (options: {
  locale: string | null;
}): Layer.Layer<IndexConfig, never, Segmenter> =>
  Layer.effect(IndexConfig)(
    Effect.gen(function* () {
      const segmenter = yield* Effect.service(Segmenter);
      return {
        locale: yield* SubscriptionRef.make(options.locale),
        segmenter: yield* SubscriptionRef.make(segmenter),
      };
    }),
  );

/**
 * Build `layer` and make its Segmenter the one every held list is rebuilt
 * with: a Chinese Segmenter install switches to the jieba layer, an uninstall
 * back to the none layer.
 */
export const switchSegmenter = <E>(
  layer: Layer.Layer<Segmenter, E>,
): Effect.Effect<void, E, IndexConfig> =>
  Effect.gen(function* () {
    const config = yield* Effect.service(IndexConfig);
    const segmenter = yield* Effect.provide(Effect.service(Segmenter), layer);
    yield* SubscriptionRef.set(config.segmenter, segmenter);
  });

/** Item search over the Libraries a caller names. */
export class ItemIndex extends Context.Service<
  ItemIndex,
  {
    /**
     * Rank the Items of `libraries` (local ids in canonical order) that match
     * `query`, best first, up to `limit`. Hydration is the caller's.
     */
    readonly search: (
      libraries: readonly number[],
      query: string,
      limit: number,
    ) => Effect.Effect<readonly ItemHit[], SourceUnavailable>;
  }
>()("zotlit/item-lookup/ItemIndex") {}

const logger = getLogger(["zotlit", "item-lookup", "item-index"]);

/** Ids read per `items` call during a build. */
const SLICE_SIZE = 500;

interface BuiltIndex {
  readonly engine: EngineIndex;
  readonly generation: number;
  /** One per covered Library, in list order. */
  readonly signatures: readonly IndexSignature[];
  /** The configuration version the index was built with. */
  readonly config: number;
}

interface Lane {
  /** Set as soon as the lane is forked. */
  fiber: Fiber.Fiber<void, SourceUnavailable> | null;
  /** Completes when the lane ends; an interrupted lane completes with void. */
  readonly done: Deferred.Deferred<void, SourceUnavailable>;
}

interface Entry {
  readonly libraries: readonly number[];
  built: BuiltIndex | null;
  lane: Lane | null;
  /** A rebuild was requested while the lane ran. */
  rerun: boolean;
  /** A search asked for this list since the last generation emission. */
  asked: boolean;
  /** Searches waiting for this list's first index. */
  waiters: number;
}

export const layerItemIndex: Layer.Layer<
  ItemIndex,
  never,
  ItemSource | IndexConfig
> = Layer.effect(ItemIndex)(
  Effect.gen(function* () {
    const source = yield* Effect.service(ItemSource);
    const config = yield* Effect.service(IndexConfig);
    const fork = yield* FiberSet.makeRuntime<never, void, SourceUnavailable>();
    const entries = new Map<string, Entry>();
    let configVersion = 0;
    let languageLookup: {
      locale: string | null;
      lookup: LanguageNameLookup;
    } | null = null;

    const lookupFor = (locale: string | null): LanguageNameLookup => {
      if (languageLookup?.locale !== locale) {
        languageLookup = { locale, lookup: createLanguageLookup(locale) };
      }
      return languageLookup.lookup;
    };

    const rebuildOnce = (entry: Entry) =>
      Effect.gen(function* () {
        const version = configVersion;
        const pinned = yield* source.pinned;
        const signatures = yield* Effect.forEach(
          entry.libraries,
          pinned.signature,
        );
        const held = entry.built;
        if (
          held !== null &&
          held.generation === pinned.generation &&
          held.config === version &&
          signaturesEqual(held.signatures, signatures)
        ) {
          logger.debug("Item index up to date; skipping rebuild", {
            libraries: entry.libraries,
            generation: pinned.generation,
          });
          return;
        }
        logger.debug("Item index build started", {
          libraries: entry.libraries,
          generation: pinned.generation,
          reason:
            held === null
              ? "no index"
              : held.generation !== pinned.generation
                ? "generation"
                : held.config !== version
                  ? "configuration"
                  : "signature",
        });
        const startedAt = performance.now();
        const locale = yield* SubscriptionRef.get(config.locale);
        const segmenter = yield* SubscriptionRef.get(config.segmenter);
        const builder = yield* makeEngineIndexBuilder({
          libraries: entry.libraries,
          languageLookup: lookupFor(locale),
        }).pipe(Effect.provideService(Segmenter, segmenter));
        for (const libraryID of entry.libraries) {
          const ids = yield* pinned.itemIDs(libraryID);
          for (let start = 0; start < ids.length; start += SLICE_SIZE) {
            const slice = ids.slice(start, start + SLICE_SIZE);
            yield* builder.add(yield* pinned.items(slice));
          }
        }
        const engine = yield* builder.build;
        entry.built = {
          engine,
          generation: pinned.generation,
          signatures,
          config: version,
        };
        logger.info("Item index built", {
          libraries: entry.libraries,
          count: engine.size,
          durationMs: performance.now() - startedAt,
        });
      }).pipe(
        Effect.scoped,
        Effect.tapError((error) =>
          Effect.sync(() => {
            entry.built = null;
            logger.debug("Item index dropped; source unavailable", {
              libraries: entry.libraries,
              error,
            });
          }),
        ),
      );

    /**
     * Start the entry's lane: rebuild, then once more per trailing request.
     * Synchronous, so the check for a running lane and the reservation of a
     * new one cannot be split by a scheduler yield.
     */
    const startLane = (entry: Entry): Lane => {
      const done = Deferred.makeUnsafe<void, SourceUnavailable>();
      const lane: Lane = { fiber: null, done };
      const run = Effect.suspend(() => {
        entry.rerun = false;
        return rebuildOnce(entry);
      }).pipe(
        Effect.repeat({ while: () => entry.rerun }),
        Effect.asVoid,
        Effect.onExit((exit) =>
          Effect.suspend(() => {
            if (entry.lane === lane) entry.lane = null;
            return Deferred.done(
              done,
              Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
                ? Exit.void
                : exit,
            );
          }),
        ),
      );
      entry.lane = lane;
      lane.fiber = fork(run);
      return lane;
    };

    /** Join the running lane, or start one. */
    const ensureLane = (entry: Entry): Lane => entry.lane ?? startLane(entry);

    /** Rebuild after the running build, or now when none runs. */
    const requestRebuild = (entry: Entry): void => {
      if (entry.lane) {
        entry.rerun = true;
        logger.debug("Item index rebuild coalesced; trailing rerun scheduled", {
          libraries: entry.libraries,
        });
      } else {
        startLane(entry);
      }
    };

    const onGeneration = Effect.suspend(() => {
      const work: Effect.Effect<void>[] = [];
      for (const [key, entry] of entries) {
        if (!entry.asked && entry.waiters === 0) {
          entries.delete(key);
          logger.debug("Item index evicted; no search since the last change", {
            libraries: entry.libraries,
          });
          const fiber = entry.lane?.fiber;
          if (fiber) work.push(Fiber.interrupt(fiber));
          continue;
        }
        entry.asked = false;
        requestRebuild(entry);
      }
      return Effect.all(work, { discard: true });
    });

    const onConfig = Effect.sync(() => {
      configVersion++;
      logger.debug("Item index configuration changed; rebuilding", {
        lists: entries.size,
      });
      for (const entry of entries.values()) requestRebuild(entry);
    });

    yield* Stream.runForEach(source.generation, () => onGeneration).pipe(
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* Stream.merge(
      Stream.drop(SubscriptionRef.changes(config.locale), 1),
      Stream.drop(SubscriptionRef.changes(config.segmenter), 1),
    ).pipe(
      Stream.runForEach(() => onConfig),
      Effect.forkScoped({ startImmediately: true }),
    );

    /** The list's held index, waiting for a build when there is none. */
    const indexFor = (
      libraries: readonly number[],
    ): Effect.Effect<EngineIndex, SourceUnavailable> =>
      Effect.gen(function* () {
        const entry = getEntry(libraries);
        entry.asked = true;
        if (entry.built === null) {
          const lane = ensureLane(entry);
          // The count rises and its release registers in one step, so an
          // interrupt cannot leave the entry counted as waited on.
          yield* Effect.acquireUseRelease(
            Effect.sync(() => {
              entry.waiters++;
            }),
            () => Deferred.await(lane.done),
            () =>
              Effect.sync(() => {
                entry.waiters--;
              }),
          );
        }
        if (entry.built) return entry.built.engine;
        // A waited-on entry is never evicted, so only the layer closing ends
        // its lane without an index.
        return yield* Effect.interrupt;
      });

    const getEntry = (libraries: readonly number[]): Entry => {
      const key = libraries.join(",");
      let entry = entries.get(key);
      if (entry === undefined) {
        entry = {
          libraries: [...libraries],
          built: null,
          lane: null,
          rerun: false,
          asked: false,
          waiters: 0,
        };
        entries.set(key, entry);
      }
      return entry;
    };

    return {
      search: (libraries, query, limit) =>
        Effect.flatMap(indexFor(libraries), (engine) =>
          searchEngineIndex(engine, query, limit),
        ),
    };
  }),
);

function signaturesEqual(
  a: readonly IndexSignature[],
  b: readonly IndexSignature[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (signature, index) =>
        signature.count === b[index]!.count &&
        signature.checksum === b[index]!.checksum,
    )
  );
}
