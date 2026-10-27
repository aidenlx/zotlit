// The live display read of one Annotation's Excerpt Image: the one Held Read
// every card that shows that Annotation is painted from.

import { hashKey } from "@tanstack/query-core";
import type { QueryKey } from "@tanstack/query-core";
import { Context, Effect, Fiber, FiberSet, Layer, Ref, Schema } from "effect";

import { scopedBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log-category";
import { QueryClients } from "@/services/query-client/service";

import {
  excerptAnnotationIdentity,
  excerptAnnotationRecord,
  excerptKey,
} from "./contract";
import type { ExcerptRequest } from "./contract";
import type { ExcerptImage } from "./format";
import { ExcerptImageService } from "./service";
import { supersedes } from "./service";
import type { AvailableExcerpt } from "./service";

/** The key prefix every live display read lives under. */
export const EXCERPT_DISPLAY = "excerpt-image-display";

/**
 * The one key a live Annotation is displayed under: the Annotation's stable
 * verified identity, never its pixels. A saved pixel-affecting edit replaces
 * what the key holds while every card keeps painting the previous image, and the
 * pixels one result answers for travel with the result itself, in the
 * `identity.key` ({@link excerptKey}) it was resolved under.
 *
 * @see apps/obsidian/docs/adr/0055-reader-edits-revalidate-excerpt-images.md
 */
export function excerptDisplayKey(request: ExcerptRequest): QueryKey {
  return [EXCERPT_DISPLAY, ...excerptAnnotationIdentity(request)];
}

/**
 * What one card paints, and what the Held Read behind it is doing.
 *
 * `image` is the latest image resolved for the Annotation. It stays while a
 * replacement runs and after one fails, so the card shows the last useful image
 * rather than dropping to nothing; `current` says whether those exact pixels are
 * the ones the saved Annotation demands now.
 */
export interface ExcerptImageDisplay {
  readonly image: ExcerptImage | null;
  readonly current: boolean;
  /**
   * - `reading`: a read is answering the demand.
   * - `failed`: no read stands for the demand — the last one answered nothing,
   *   so a previous image still paints.
   * - `cleared`: a manual clear released the display — the clear removed the
   *   Held Read and the bytes it was painted from, so nothing paints, not even
   *   the image the clear removed.
   * - `settled`: the read committed.
   * - `absent`: the card demands nothing — no source, no scope.
   */
  readonly status: "reading" | "failed" | "cleared" | "settled" | "absent";
}

/**
 * One card's demand on the live image of the Annotation it shows.
 *
 * The card re-states the demand as the record it paints moves. Releasing it
 * stops this card's demand alone: a read another card still wants runs on, and
 * the last demand going is what releases the read.
 */
export interface ExcerptDisplayDemand {
  /** State what this card shows now; `null` paints the established unavailable output. */
  readonly demand: (request: ExcerptRequest | null) => void;
  /** Stop demanding. */
  readonly release: () => void;
  /** Listen for every change that moves {@link snapshot}. */
  readonly subscribe: (onChange: () => void) => () => void;
  /** The display at one instant, as one object until it moves. */
  readonly snapshot: () => ExcerptImageDisplay;
}

/** One live display read per Annotation, shared by every card that shows it. */
interface Slot {
  readonly hash: string;
  readonly key: QueryKey;
  readonly state: Ref.Ref<SlotState>;
}

interface SlotState {
  /** The latest saved request: what the next read resolves. */
  readonly latest: ExcerptRequest;
  readonly read: {
    readonly excerpt: string;
    readonly fiber: Fiber.Fiber<void>;
  } | null;
  readonly cards: ReadonlySet<Card>;
}

/** One card's demand, cached snapshot, and subscribed view callbacks. */
interface CardState {
  readonly slot: Slot | null;
  readonly demand: ExcerptRequest | null;
  /** An unstated demand is still loading. */
  readonly stated: boolean;
  /** One object until publication moves the snapshot. */
  readonly held: ExcerptImageDisplay | null;
  readonly listeners: ReadonlySet<() => void>;
}
type Card = Ref.Ref<CardState>;

/** An Annotation whose pixels have no available image. */
export class ExcerptUnavailable extends Schema.TaggedError<
  ExcerptUnavailable,
  { readonly brand: unique symbol }
>()("ExcerptUnavailable", { annotationKey: Schema.String }) {
  override get message() {
    return `No excerpt image is available for ${this.annotationKey}`;
  }
}

/** The plugin's live display reads, shared across cards and saved edits. */
export class ExcerptDisplays extends Context.Service<
  ExcerptDisplays,
  {
    readonly open: Effect.Effect<ExcerptDisplayDemand>;
    readonly clear: Effect.Effect<void>;
    readonly refresh: Effect.Effect<void>;
    revalidate(request: ExcerptRequest): Effect.Effect<void>;
  }
>()("zotlit/excerpt-image/ExcerptDisplays") {}

export const layerExcerptDisplays = Layer.effect(
  ExcerptDisplays,
  Effect.gen(function* () {
    const images = yield* ExcerptImageService;
    const queries = yield* QueryClients;
    const jobs = yield* FiberSet.make<void, never>();
    // Card callbacks and Query Core's Promise query function are execution edges.
    const bridge = yield* scopedBridge;
    const slots = yield* Ref.make<ReadonlyMap<string, Slot>>(new Map());
    const refreshes = yield* Ref.make<ReadonlyMap<string, Fiber.Fiber<void>>>(
      new Map(),
    );

    const peek = (slot: Slot) => queries.peek<AvailableExcerpt>(slot.key);
    const snapshot = Effect.fnUntraced(function* (
      card: CardState,
    ): Effect.fn.Return<ExcerptImageDisplay> {
      const slot = card.slot;
      if (!slot || !card.demand)
        return {
          image: null,
          current: false,
          status: card.demand ? "cleared" : card.stated ? "absent" : "reading",
        };
      const held = yield* peek(slot);
      if (!held)
        return {
          image: null,
          current: false,
          status:
            (yield* Ref.get(slot.state)).read === null ? "failed" : "reading",
        };
      return {
        image: held.value,
        current: held.value.identity.key === excerptKey(card.demand),
        status:
          held.status === "revalidating"
            ? "reading"
            : held.status === "failed"
              ? "failed"
              : "settled",
      };
    });
    const current = Effect.fnUntraced(function* (card: Card) {
      const state = yield* Ref.get(card);
      if (state.held) return state.held;
      const held = yield* snapshot(state);
      yield* Ref.update(card, (value) => ({ ...value, held }));
      return held;
    });
    const publish = Effect.fnUntraced(function* (card: Card) {
      const listeners = yield* Ref.modify(card, (state) => [
        state.listeners,
        { ...state, held: null },
      ]);
      for (const listener of listeners) listener();
    });
    const notify = Effect.fnUntraced(function* (slot: Slot) {
      for (const card of (yield* Ref.get(slot.state)).cards)
        yield* publish(card);
    });
    const drop = Effect.fnUntraced(function* (slot: Slot) {
      const reading = yield* Ref.modify(slot.state, (state) => [
        state.read,
        { ...state, read: null },
      ]);
      // Query Core cancels publication before interruption waits for finalizers.
      queries.client.removeQueries({ queryKey: slot.key });
      if (reading) yield* Fiber.interrupt(reading.fiber);
    });
    const leave = Effect.fnUntraced(function* (card: Card) {
      const slot = (yield* Ref.get(card)).slot;
      if (!slot) return;
      yield* Ref.update(card, (state) => ({ ...state, slot: null }));
      const remaining = yield* Ref.modify(slot.state, (state) => {
        const cards = new Set(state.cards);
        cards.delete(card);
        return [cards.size, { ...state, cards }];
      });
      if (remaining > 0) return;
      yield* Ref.update(slots, (held) => {
        const next = new Map(held);
        next.delete(slot.hash);
        return next;
      });
      yield* drop(slot);
    });
    const seed = Effect.fnUntraced(function* (slot: Slot) {
      if ((yield* peek(slot)) !== null) return;
      const stored = yield* images.stored((yield* Ref.get(slot.state)).latest);
      if (
        !stored ||
        (yield* Ref.get(slots)).get(slot.hash) !== slot ||
        (yield* peek(slot)) !== null
      )
        return;
      queries.client.setQueryData<AvailableExcerpt>(slot.key, stored);
      yield* notify(slot);
    });
    const resolve = Effect.fnUntraced(function* (request: ExcerptRequest) {
      const outcome = yield* images.resolve(request);
      if (outcome.kind === "unavailable") {
        yield* Effect.logDebug("Excerpt display has no image", {
          annotationKey: request.annotation.key,
        });
        return yield* new ExcerptUnavailable({
          annotationKey: request.annotation.key,
        });
      }
      return outcome;
    });
    const start = Effect.fnUntraced(function* (slot: Slot) {
      const previous = yield* Ref.modify(slot.state, (state) => [
        state,
        { ...state, read: null },
      ]);
      const request = previous.latest;
      yield* queries.invalidate(slot.key);
      if (previous.read) yield* Fiber.interrupt(previous.read.fiber);

      // The read owns both jobs. A stored fallback can arrive after the
      // fresh resolution fails, so both finish before this work settles.
      const work: Effect.Effect<void> = Effect.all(
        [
          seed(slot),
          queries.read<AvailableExcerpt>(slot.key, ({ signal }) =>
            bridge.runPromise(resolve(request), { signal }),
          ),
        ],
        { concurrency: "unbounded", discard: true },
      ).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            const finished = yield* Ref.modify(slot.state, (state) =>
              state.read === reading
                ? [true, { ...state, read: null }]
                : [false, state],
            );
            if (finished) yield* notify(slot);
          }),
        ),
      );
      const fiber = yield* FiberSet.run(jobs, work);
      const reading = { excerpt: excerptKey(request), fiber };
      yield* Ref.update(slot.state, (state) => ({ ...state, read: reading }));
    });
    const read = Effect.fnUntraced(function* (slot: Slot) {
      const state = yield* Ref.get(slot.state);
      const wanted = excerptKey(state.latest);
      const running = state.read?.excerpt ?? null;
      if (running === wanted) return;
      if (
        running === null &&
        (yield* peek(slot))?.value.identity.key === wanted
      )
        return;
      yield* start(slot);
    });
    const advance = (slot: Slot, request: ExcerptRequest) =>
      Ref.update(slot.state, (state) =>
        supersedes(request.annotation.version, state.latest.annotation.version)
          ? { ...state, latest: request }
          : state,
      );
    const demand = Effect.fnUntraced(function* (
      card: Card,
      request: ExcerptRequest | null,
    ) {
      const key = request ? excerptDisplayKey(request) : null;
      const hash = key ? hashKey(key) : null;
      const previous = (yield* Ref.get(card)).slot;
      if (previous && previous.hash !== hash) yield* leave(card);
      yield* Ref.update(card, (state) => ({
        ...state,
        demand: request,
        stated: true,
      }));
      if (request && key && hash) {
        let slot = (yield* Ref.get(slots)).get(hash);
        if (slot) {
          yield* advance(slot, request);
        } else {
          slot = {
            hash,
            key,
            state: yield* Ref.make<SlotState>({
              latest: request,
              read: null,
              cards: new Set(),
            }),
          };
          const opened = slot;
          yield* Ref.update(slots, (held) => new Map(held).set(hash, opened));
        }
        yield* Ref.update(slot.state, (state) => ({
          ...state,
          cards: new Set(state.cards).add(card),
        }));
        const joined = slot;
        yield* Ref.update(card, (state) => ({ ...state, slot: joined }));
        yield* read(slot);
        yield* notify(slot);
        return;
      }
      yield* publish(card);
    });
    const replaceStored = Effect.fnUntraced(function* (
      request: ExcerptRequest,
    ) {
      const annotation = excerptAnnotationRecord(request);
      const previous = (yield* Ref.get(refreshes)).get(annotation);
      if (previous) yield* Fiber.interrupt(previous);
      const work: Effect.Effect<void> = Effect.gen(function* () {
        const stored = yield* images.stored(request);
        if (!stored || stored.identity.key === excerptKey(request)) return;
        yield* images.resolve(request);
      }).pipe(
        Effect.catch((error) =>
          Effect.logDebug("Stored excerpt replacement failed", {
            annotationKey: request.annotation.key,
            error,
          }),
        ),
        Effect.ensuring(
          Ref.update(refreshes, (held) => {
            if (held.get(annotation) !== fiber) return held;
            const next = new Map(held);
            next.delete(annotation);
            return next;
          }),
        ),
      );
      const fiber = yield* FiberSet.run(jobs, work, {
        startImmediately: false,
      });
      yield* Ref.update(refreshes, (held) =>
        new Map(held).set(annotation, fiber),
      );
    });
    const clear = Effect.gen(function* () {
      const cleared = yield* Ref.getAndSet(slots, new Map());
      for (const slot of cleared.values()) {
        yield* drop(slot);
        for (const card of (yield* Ref.get(slot.state)).cards)
          yield* Ref.update(card, (state) => ({ ...state, slot: null }));
        yield* notify(slot);
      }
      yield* Fiber.interruptAll((yield* Ref.get(refreshes)).values());
      yield* Ref.set(refreshes, new Map());
    }).pipe(Effect.withSpan("ExcerptDisplays.clear"));
    yield* Effect.acquireRelease(
      queries.watch([EXCERPT_DISPLAY], {
        settled: (key) =>
          bridge.runSync(
            Effect.gen(function* () {
              const slot = (yield* Ref.get(slots)).get(hashKey(key));
              if (slot) yield* notify(slot);
            }),
          ),
      }),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    yield* Effect.addFinalizer(() => clear);
    return ExcerptDisplays.of({
      open: Effect.gen(function* (): Effect.fn.Return<ExcerptDisplayDemand> {
        const card = yield* Ref.make<CardState>({
          slot: null,
          demand: null,
          stated: false,
          held: null,
          listeners: new Set(),
        });
        return {
          demand: (request) => bridge.runAndForget(demand(card, request)),
          release: () =>
            bridge.runAndForget(
              Effect.gen(function* () {
                yield* leave(card);
                yield* Ref.update(card, (state) => ({
                  ...state,
                  demand: null,
                  stated: false,
                }));
                yield* publish(card);
              }),
            ),
          subscribe: (onChange) => {
            bridge.runSync(
              Ref.update(card, (state) => ({
                ...state,
                listeners: new Set(state.listeners).add(onChange),
              })),
            );
            return () =>
              bridge.runSync(
                Ref.update(card, (state) => {
                  const listeners = new Set(state.listeners);
                  listeners.delete(onChange);
                  return { ...state, listeners };
                }),
              );
          },
          snapshot: () => bridge.runSync(current(card)),
        };
      }).pipe(Effect.withSpan("ExcerptDisplays.open")),
      clear,
      refresh: Effect.gen(function* () {
        for (const slot of (yield* Ref.get(slots)).values()) {
          yield* start(slot);
          yield* notify(slot);
        }
      }).pipe(Effect.withSpan("ExcerptDisplays.refresh")),
      revalidate: Effect.fn("ExcerptDisplays.revalidate")(function* (request) {
        const slot = (yield* Ref.get(slots)).get(
          hashKey(excerptDisplayKey(request)),
        );
        if (!slot) return yield* replaceStored(request);
        yield* advance(slot, request);
        yield* read(slot);
        yield* notify(slot);
      }),
    });
  }).pipe(withLogCategory("excerpt-image")),
);
