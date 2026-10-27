// The live display read of one Annotation's Excerpt Image: the one Held Read
// every card that shows that Annotation is painted from.

import { hashKey } from "@tanstack/query-core";
import type { QueryKey } from "@tanstack/query-core";
import { Context, Effect, Fiber, Layer, Scope } from "effect";

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
  /** Hashed display key, which is what the slot map is keyed by. */
  readonly hash: string;
  readonly key: QueryKey;
  /** The latest saved request: what the next read resolves. */
  latest: ExcerptRequest;
  /** The excerpt key of the read in flight, with its settlement. */
  read: { excerpt: string; fiber: Fiber.Fiber<void> } | null;
  readonly cards: Set<Card>;
}

/** One card's demand, and the listeners its snapshot moves for. */
interface Card {
  slot: Slot | null;
  /** The request the card demands now, `null` where it demands nothing. */
  demand: ExcerptRequest | null;
  /** Whether the card has stated a demand yet; an unstated one is still loading. */
  stated: boolean;
  /** The snapshot last answered, so a render sees the same object until it moves. */
  held: ExcerptImageDisplay | null;
  readonly listeners: Set<() => void>;
}

/** An Annotation whose pixels have no available image. */
export class ExcerptUnavailable extends Error {
  readonly _tag = "ExcerptUnavailable";

  constructor(annotationKey: string) {
    super(`No excerpt image is available for ${annotationKey}`);
    this.name = "ExcerptUnavailable";
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
    const scope = yield* Scope.Scope;
    // Card callbacks and Query Core's Promise query function are execution edges.
    const bridge = yield* scopedBridge;
    const slots = new Map<string, Slot>();
    const refreshes = new Map<string, Fiber.Fiber<void>>();

    const peek = (slot: Slot) => queries.peek<AvailableExcerpt>(slot.key);
    const snapshot = Effect.fnUntraced(function* (
      card: Card,
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
          status: slot.read === null ? "failed" : "reading",
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
    const publish = (card: Card) =>
      Effect.sync(() => {
        card.held = null;
        for (const listener of card.listeners) listener();
      });
    const notify = Effect.fnUntraced(function* (slot: Slot) {
      for (const card of slot.cards) yield* publish(card);
    });
    const drop = Effect.fnUntraced(function* (slot: Slot) {
      const reading = slot.read;
      slot.read = null;
      // Query Core cancels publication before interruption waits for finalizers.
      queries.client.removeQueries({ queryKey: slot.key });
      if (reading) yield* Fiber.interrupt(reading.fiber);
    });
    const leave = Effect.fnUntraced(function* (card: Card) {
      const slot = card.slot;
      if (!slot) return;
      card.slot = null;
      slot.cards.delete(card);
      if (slot.cards.size > 0) return;
      slots.delete(slot.hash);
      yield* drop(slot);
    });
    const seed = Effect.fnUntraced(function* (slot: Slot) {
      if ((yield* peek(slot)) !== null) return;
      const stored = yield* images.stored(slot.latest);
      if (
        !stored ||
        slots.get(slot.hash) !== slot ||
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
        return yield* Effect.fail(
          new ExcerptUnavailable(request.annotation.key),
        );
      }
      return outcome;
    });
    const start = Effect.fnUntraced(function* (slot: Slot) {
      const request = slot.latest;
      const previous = slot.read;
      slot.read = null;
      yield* queries.invalidate(slot.key);
      if (previous) yield* Fiber.interrupt(previous.fiber);

      // The read owns both jobs. A stored fallback can arrive after the
      // fresh resolution fails, so both finish before this work settles.
      const work = Effect.all(
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
            if (slot.read !== reading) return;
            slot.read = null;
            yield* notify(slot);
          }),
        ),
      );
      const fiber = yield* Effect.forkIn(work, scope, {
        startImmediately: true,
      });
      const reading = { excerpt: excerptKey(request), fiber };
      slot.read = reading;
    });
    const read = Effect.fnUntraced(function* (slot: Slot) {
      const wanted = excerptKey(slot.latest);
      const running = slot.read?.excerpt ?? null;
      if (running === wanted) return;
      if (
        running === null &&
        (yield* peek(slot))?.value.identity.key === wanted
      )
        return;
      yield* start(slot);
    });
    const demand = Effect.fnUntraced(function* (
      card: Card,
      request: ExcerptRequest | null,
    ) {
      const key = request ? excerptDisplayKey(request) : null;
      const hash = key ? hashKey(key) : null;
      if (card.slot && card.slot.hash !== hash) yield* leave(card);
      card.demand = request;
      card.stated = true;
      if (request && key && hash) {
        let slot = slots.get(hash);
        if (slot) {
          if (
            supersedes(
              request.annotation.version,
              slot.latest.annotation.version,
            )
          )
            slot.latest = request;
        } else {
          slot = { hash, key, latest: request, read: null, cards: new Set() };
          slots.set(hash, slot);
        }
        slot.cards.add(card);
        card.slot = slot;
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
      const previous = refreshes.get(annotation);
      if (previous) yield* Fiber.interrupt(previous);
      const work = Effect.gen(function* () {
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
          Effect.sync(() => {
            if (refreshes.get(annotation) === fiber)
              refreshes.delete(annotation);
          }),
        ),
      );
      const fiber = yield* Effect.forkIn(work, scope);
      refreshes.set(annotation, fiber);
    });
    const clear = Effect.gen(function* () {
      const cleared = Array.from(slots.values());
      slots.clear();
      for (const slot of cleared) {
        yield* drop(slot);
        for (const card of slot.cards) card.slot = null;
        yield* notify(slot);
      }
      yield* Fiber.interruptAll(refreshes.values());
      refreshes.clear();
    }).pipe(Effect.withSpan("ExcerptDisplays.clear"));
    yield* Effect.acquireRelease(
      queries.watch([EXCERPT_DISPLAY], {
        settled: (key) => {
          const slot = slots.get(hashKey(key));
          if (slot) bridge.runSync(notify(slot));
        },
      }),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    yield* Effect.addFinalizer(() => clear);
    return ExcerptDisplays.of({
      open: Effect.sync((): ExcerptDisplayDemand => {
        const card: Card = {
          slot: null,
          demand: null,
          stated: false,
          held: null,
          listeners: new Set(),
        };
        return {
          demand: (request) => bridge.runAndForget(demand(card, request)),
          release: () =>
            bridge.runAndForget(
              Effect.gen(function* () {
                yield* leave(card);
                card.demand = null;
                card.stated = false;
                yield* publish(card);
              }),
            ),
          subscribe: (onChange) => {
            card.listeners.add(onChange);
            return () => card.listeners.delete(onChange);
          },
          snapshot: () => (card.held ??= bridge.runSync(snapshot(card))),
        };
      }).pipe(Effect.withSpan("ExcerptDisplays.open")),
      clear,
      refresh: Effect.gen(function* () {
        for (const slot of slots.values()) {
          yield* start(slot);
          yield* notify(slot);
        }
      }).pipe(Effect.withSpan("ExcerptDisplays.refresh")),
      revalidate: Effect.fn("ExcerptDisplays.revalidate")(function* (request) {
        const slot = slots.get(hashKey(excerptDisplayKey(request)));
        if (!slot) return yield* replaceStored(request);
        if (
          supersedes(request.annotation.version, slot.latest.annotation.version)
        )
          slot.latest = request;
        yield* read(slot);
        yield* notify(slot);
      }),
    });
  }).pipe(withLogCategory("excerpt-image")),
);
