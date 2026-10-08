// The Item Index: item search over the Libraries a caller names, built from an ItemSource.
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
 *   keeps the index. The list the latest search asked for stays held. Any
 *   other list no search asked for since the last emission, and that no
 *   search waits on, is evicted and its build interrupted.
 * - A build reads one pinned source for its whole life, in slices, and yields
 *   to the scheduler after each slice.
 * - A held index keeps the pinned source it was built on, or last verified
 *   against with equal signatures, until a newer index replaces it or the list
 *   leaves. A search hydrates its hits on that source, so the rows and the
 *   highlight ranges describe one state.
 * - A locale or Segmenter change through `configure` rebuilds every held
 *   list.
 */
import { getLogger } from "@logtape/logtape";
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
  Scope,
  Semaphore,
  Stream,
} from "effect";

import { createLanguageLookup } from "@zotlit/db";
import type {
  IndexedItem,
  IndexSignature,
  Item,
  LanguageNameLookup,
} from "@zotlit/db";

import { makeEngineIndexBuilder, searchEngineIndex } from "./engine";
import type { EngineIndex, SearchMatches } from "./engine";
import { layerSegmenterNone, Segmenter } from "./segmenter";
import { makeSegmenterSwitch, SegmenterBinaryReader } from "./segmenter-switch";
import type { SegmenterBinary } from "./segmenter-switch";

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
  /** The live Items for Indexed Keys, keyed by Indexed Key; a key that no longer resolves is absent. */
  readonly itemsByIndexedKey: (
    indexedKeys: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, Item>, SourceUnavailable>;
}

/** The port the Item Index reads Items through. */
export class ItemSource extends Context.Service<
  ItemSource,
  {
    /**
     * Emits each time the source may have changed. The next pinned source
     * reports the generation after the change; it rises when the source behind
     * the port is swapped. The stream emits only changes after the
     * subscription, never a replay of the current state.
     */
    readonly generation: Stream.Stream<void>;
    /** A source bound to one state until the caller's scope closes. */
    readonly pinned: Effect.Effect<
      PinnedItemSource,
      SourceUnavailable,
      Scope.Scope
    >;
  }
>()("zotlit/item-lookup/ItemSource") {}

/** The settings an index is built with. */
export interface IndexSettings {
  /** The UI locale, for creator-name language lookup; `null` for none. */
  readonly locale: string | null;
  /** The installed Chinese Segmenter binary; `null` cuts CJK text with `Intl.Segmenter`. */
  readonly segmenterBinary: SegmenterBinary | null;
}

/** One ranked answer of a search: the hydrated Item and the ranges of its title that matched. */
export interface SearchHit {
  readonly item: Item;
  readonly matches: SearchMatches;
}

/** Item search over the Libraries a caller names. */
export class ItemIndex extends Context.Service<
  ItemIndex,
  {
    /**
     * Rank the Items of `libraries` (local ids in canonical order) that match
     * `query`, best first, up to `limit`, hydrated on the source the answering
     * index holds. A hit whose Item no longer resolves there is dropped.
     */
    readonly search: (
      libraries: readonly number[],
      query: string,
      limit: number,
    ) => Effect.Effect<readonly SearchHit[], SourceUnavailable>;
    /**
     * Replace the settings. Calls serialize in arrival order. Returns once the
     * Segmenter switch is applied and the rebuilds of held lists are scheduled
     * (not finished).
     */
    readonly configure: (settings: IndexSettings) => Effect.Effect<void>;
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
  /** The pinned source the index was built on or last verified against. */
  readonly binding: Binding;
}

/** A pinned source a held index keeps; it closes once retired and unused. */
interface Binding {
  readonly source: PinnedItemSource;
  readonly scope: Scope.Closeable;
  /** Searches that hold the source for hydration now. */
  users: number;
  /** No index holds the source any more. */
  retired: boolean;
}

/** Retire `binding`; its source closes now, or after its last search. */
const retire = (binding: Binding | undefined): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (!binding || binding.retired) return Effect.void;
    binding.retired = true;
    return binding.users === 0
      ? Scope.close(binding.scope, Exit.void)
      : Effect.void;
  });

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

/**
 * The Item Index, starting with `initial`. The initial Segmenter resolves
 * before the index exists, so no search sees it half-configured.
 */
export const layerItemIndex = (
  initial: IndexSettings,
): Layer.Layer<ItemIndex, never, ItemSource | SegmenterBinaryReader> =>
  Layer.effect(ItemIndex)(makeItemIndex(initial));

function makeItemIndex(initial: IndexSettings) {
  return Effect.gen(function* () {
    const source = yield* Effect.service(ItemSource);
    const segmenterSwitch = makeSegmenterSwitch(
      yield* Effect.service(SegmenterBinaryReader),
    );
    let settings = initial;
    /** The Segmenter every build cuts with. */
    let segmenter =
      (yield* segmenterSwitch.resolve(initial.segmenterBinary)) ??
      (yield* Effect.provide(Effect.service(Segmenter), layerSegmenterNone));
    /** One `configure` at a time, in arrival order. */
    const configuring = yield* Semaphore.make(1);
    const entries = new Map<string, Entry>();
    /** The list the latest search asked for; no emission evicts it. */
    let latest: Entry | null = null;
    // Registered before the lanes' FiberSet, so it runs after every lane
    // ended: no lane can bind a source after it.
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        entries.values(),
        (entry) =>
          entry.built
            ? Scope.close(entry.built.binding.scope, Exit.void)
            : Effect.void,
        { discard: true },
      ),
    );
    const fork = yield* FiberSet.makeRuntime<never, void, SourceUnavailable>();
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

    /** Hold `built` for the entry and retire the binding it replaces. */
    const hold = (entry: Entry, built: BuiltIndex) =>
      Effect.suspend(() => {
        const replaced = entry.built?.binding;
        entry.built = built;
        return retire(replaced);
      });

    /** Drop the entry's index and retire its binding. */
    const drop = (entry: Entry) =>
      Effect.suspend(() => {
        const replaced = entry.built?.binding;
        entry.built = null;
        return retire(replaced);
      });

    /**
     * Re-check the entry on a fresh pinned source: keep the index on equal
     * signatures, build a new one otherwise. Either way the entry then holds
     * the fresh source; a pinned source no index takes closes at the end.
     */
    const rebuildOnce = (entry: Entry) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const scope = yield* Scope.make();
          let held = false;
          const holdOnce = (built: BuiltIndex) =>
            Effect.suspend(() => {
              held = true;
              return hold(entry, built);
            }).pipe(Effect.uninterruptible);
          return yield* restore(checkAndBuild(entry, scope, holdOnce)).pipe(
            Effect.onExit(() =>
              held ? Effect.void : Scope.close(scope, Exit.void),
            ),
          );
        }),
      ).pipe(
        Effect.tapError((error) =>
          Effect.andThen(
            drop(entry),
            Effect.sync(() => {
              logger.debug("Item index dropped; source unavailable", {
                libraries: entry.libraries,
                error,
              });
            }),
          ),
        ),
      );

    const checkAndBuild = (
      entry: Entry,
      scope: Scope.Closeable,
      holdOnce: (built: BuiltIndex) => Effect.Effect<void>,
    ) =>
      Effect.gen(function* () {
        const version = configVersion;
        const pinned = yield* Scope.provide(source.pinned, scope);
        const binding: Binding = {
          source: pinned,
          scope,
          users: 0,
          retired: false,
        };
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
          // Equal signatures: the fresh source holds what the index holds.
          yield* holdOnce({ ...held, binding });
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
        const builder = yield* makeEngineIndexBuilder({
          libraries: entry.libraries,
          languageLookup: lookupFor(settings.locale),
        }).pipe(Effect.provideService(Segmenter, segmenter));
        for (const libraryID of entry.libraries) {
          const ids = yield* pinned.itemIDs(libraryID);
          for (let start = 0; start < ids.length; start += SLICE_SIZE) {
            const slice = ids.slice(start, start + SLICE_SIZE);
            yield* builder.add(yield* pinned.items(slice));
          }
        }
        const engine = yield* builder.build;
        yield* holdOnce({
          engine,
          generation: pinned.generation,
          signatures,
          config: version,
          binding,
        });
        logger.debug("Item index built", {
          libraries: entry.libraries,
          count: engine.size,
          durationMs: performance.now() - startedAt,
        });
      });

    /**
     * Start the entry's lane: rebuild, then once more per trailing request.
     * Synchronous, so the check for a running lane and the reservation of a
     * new one cannot be split by a scheduler yield.
     */
    const startLane = (entry: Entry): Lane => {
      const done = Deferred.makeUnsafe<void, SourceUnavailable>();
      const lane: Lane = { fiber: null, done };
      // The check for a trailing request and the lane's release are one
      // synchronous step, so a request cannot land between them and be lost.
      const loop: Effect.Effect<void, SourceUnavailable> = Effect.suspend(
        () => {
          entry.rerun = false;
          return rebuildOnce(entry);
        },
      ).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (entry.rerun) return loop;
            if (entry.lane === lane) entry.lane = null;
            return Effect.void;
          }),
        ),
      );
      const run = loop.pipe(
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
        if (!entry.asked && entry.waiters === 0 && entry !== latest) {
          entries.delete(key);
          logger.debug("Item index evicted; no search since the last change", {
            libraries: entry.libraries,
          });
          const fiber = entry.lane?.fiber;
          if (fiber) work.push(Fiber.interrupt(fiber));
          work.push(drop(entry));
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

    const configure = (next: IndexSettings): Effect.Effect<void> =>
      Effect.gen(function* () {
        // The locale and the Segmenter land in one change, so every held
        // list rebuilds once for both.
        const switched = yield* segmenterSwitch.resolve(next.segmenterBinary);
        const changed =
          switched !== undefined || next.locale !== settings.locale;
        settings = next;
        if (switched) segmenter = switched;
        if (changed) yield* onConfig;
      }).pipe(configuring.withPermits(1));

    /** The list's entry once it holds an index, waiting for a build when none. */
    const indexFor = (
      libraries: readonly number[],
    ): Effect.Effect<Entry, SourceUnavailable> =>
      Effect.gen(function* () {
        const entry = getEntry(libraries);
        entry.asked = true;
        latest = entry;
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
        if (entry.built) return entry;
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

    /**
     * Hold the entry's index and its binding for the caller's scope. `null`
     * when the index was dropped since `indexFor` answered.
     */
    const holdIndex = (entry: Entry) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const built = entry.built;
          if (built) built.binding.users++;
          return built;
        }),
        (built) =>
          Effect.suspend(() => {
            if (!built) return Effect.void;
            const binding = built.binding;
            binding.users--;
            return binding.retired && binding.users === 0
              ? Scope.close(binding.scope, Exit.void)
              : Effect.void;
          }),
      );

    // Hydration reads the source the answering index holds, so the rows and
    // the highlight ranges describe one state.
    const search = (
      libraries: readonly number[],
      query: string,
      limit: number,
    ): Effect.Effect<readonly SearchHit[], SourceUnavailable> =>
      Effect.scoped(
        Effect.gen(function* () {
          const built = yield* holdIndex(yield* indexFor(libraries));
          // Dropped in between: wait for the list's next index.
          if (!built) return yield* search(libraries, query, limit);
          const hits = yield* searchEngineIndex(built.engine, query, limit);
          const items = yield* built.binding.source.itemsByIndexedKey(
            hits.map((hit) => hit.indexedKey),
          );
          return hits.flatMap((hit): SearchHit[] => {
            const item = items.get(hit.indexedKey);
            return item ? [{ item, matches: hit.matches }] : [];
          });
        }),
      );

    return { search, configure };
  });
}

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
