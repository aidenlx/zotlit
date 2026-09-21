// The live display read of one Annotation's Excerpt Image: the one Held Read
// every card that shows that Annotation is painted from.

import { hashKey } from "@tanstack/query-core";
import type { QueryFunctionContext, QueryKey } from "@tanstack/query-core";

import { getLogger } from "@/lib/log";
import type { QueryClientService } from "@/services/query-client/service";
import { Service } from "@/services/service-base";

import {
  excerptAnnotationIdentity,
  excerptAnnotationRecord,
  excerptKey,
} from "./contract";
import type { ExcerptRequest } from "./contract";
import type { ExcerptImage } from "./format";
import type { AvailableExcerpt, ExcerptImageService } from "./service";

const logger = getLogger("excerpt-image");

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
  read: { excerpt: string; settled: Promise<unknown> } | null;
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

export interface ExcerptDisplayDeps {
  /** The plugin's one query client, where every display read is held. */
  queries: Pick<
    QueryClientService,
    "client" | "invalidate" | "peek" | "read" | "watch"
  >;
  /** One resolution of one request, through the shared PDF queue. */
  resolve: ExcerptImageService["resolve"];
  /**
   * The image this device last displayed for one Annotation, which a display
   * that has nothing yet paints while the Annotation's pixels resolve.
   */
  stored: ExcerptImageService["stored"];
}

/** An Annotation whose pixels have no image: nothing rendered, nothing in Zotero's cache. */
export class ExcerptUnavailable extends Error {
  constructor(annotationKey: string) {
    super(`No excerpt image is available for ${annotationKey}`);
    this.name = "ExcerptUnavailable";
  }
}

/**
 * The plugin's live display surface for Excerpt Images.
 *
 * A card demands the image of the Annotation it shows; a saved pixel-affecting
 * edit revalidates it with the record that was saved. Both read the same key, so
 * an edit that lands while its card re-renders is one resolution rather than
 * two, and a superseded resolution is cancelled before its result can publish.
 *
 * React Query coordinates this display state alone. Every read ends in
 * {@link ExcerptImageService.resolve}, which owns the queue, the renderer, and
 * the cache.
 */
export class ExcerptDisplayService extends Service<void> {
  readonly ready: Promise<void>;
  readonly #deps: ExcerptDisplayDeps;
  /** One slot per Annotation, while a card demands it. */
  readonly #slots = new Map<string, Slot>();
  /**
   * One replacement per Annotation nothing displays, while it runs: the saved
   * edit that started it, which a later edit aborts.
   */
  readonly #refreshes = new Map<string, AbortController>();

  constructor(deps: ExcerptDisplayDeps) {
    super();
    this.#deps = deps;
    this.ready = this.#load();
  }

  /** Open one card's demand on the image of the Annotation it shows. */
  open(): ExcerptDisplayDemand {
    const card: Card = {
      slot: null,
      demand: null,
      stated: false,
      held: null,
      listeners: new Set(),
    };
    return {
      demand: (request) => {
        this.#demand(card, request);
      },
      release: () => {
        this.#leave(card);
        card.demand = null;
        card.stated = false;
        this.#publish(card);
      },
      subscribe: (onChange) => {
        card.listeners.add(onChange);
        return () => card.listeners.delete(onChange);
      },
      snapshot: () => (card.held ??= this.#snapshot(card)),
    };
  }

  /**
   * A saved edit moved this Annotation's pixels: read the live display of the
   * record that was saved, so a card that has not re-rendered yet still
   * resolves against the saved pixels rather than the superseded ones.
   *
   * An Annotation nothing displays is replaced in the background instead, and
   * only while this device still holds an image for it: one it never displayed
   * stays on demand until a card asks for it.
   */
  revalidate(request: ExcerptRequest): void {
    const slot = this.#slots.get(hashKey(excerptDisplayKey(request)));
    if (!slot) {
      void this.#replaceStored(request);
      return;
    }
    slot.latest = request;
    this.#read(slot);
    this.#notify(slot);
  }

  /**
   * Release every live display — a manual clear, which removes the Held Reads
   * together with the bytes and references they were painted from.
   *
   * The cards mounted when the clear lands release the image they were painted
   * from in the same step, through the publication every other move of a slot
   * goes through. A card that repaints after the clear therefore shows the
   * unavailable output rather than the image the clear removed, until its own
   * demand asks the display again.
   */
  clear(): void {
    // Every slot leaves the map first, so a demand one of the publications below
    // starts builds the read the clear took away instead of joining a slot that
    // is on its way out.
    const cleared = Array.from(this.#slots.values());
    this.#slots.clear();
    for (const slot of cleared) {
      // The drop comes first: the publication below moves every card off a
      // display that holds nothing, never off the image the drop just removed.
      this.#drop(slot);
      // A cleared slot releases its cards: they go on demanding their pixels,
      // and the next demand builds the read the clear took away.
      for (const card of slot.cards) card.slot = null;
      this.#notify(slot);
    }
    for (const refresh of this.#refreshes.values()) refresh.abort();
    this.#refreshes.clear();
  }

  /**
   * Read every live display again — the explicit Refresh gesture, which retries
   * an unchanged request because the PDF behind it may have been replaced.
   */
  refresh(): void {
    for (const slot of this.#slots.values()) {
      this.#readAgain(slot);
      this.#notify(slot);
    }
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(
      this.#deps.queries.watch([EXCERPT_DISPLAY], {
        settled: (key) => {
          const slot = this.#slots.get(hashKey(key));
          if (slot) this.#notify(slot);
        },
      }),
    );
    // The display holds no image of its own: a slot that no card demands goes,
    // and the bytes stay in the device-local store the capability owns.
    stack.defer(() => {
      this.clear();
    });
    this.commit(stack.move());
  }

  /** State one card's demand, moving it between slots as its Annotation changes. */
  #demand(card: Card, request: ExcerptRequest | null): void {
    const key = request ? excerptDisplayKey(request) : null;
    const hash = key ? hashKey(key) : null;
    if (card.slot && card.slot.hash !== hash) this.#leave(card);
    card.demand = request;
    card.stated = true;
    if (request && key && hash) {
      let slot = this.#slots.get(hash);
      if (slot) slot.latest = request;
      else {
        slot = {
          hash,
          key,
          latest: request,
          read: null,
          cards: new Set(),
        };
        this.#slots.set(hash, slot);
      }
      slot.cards.add(card);
      card.slot = slot;
      this.#read(slot);
      void this.#seed(slot);
      this.#notify(slot);
      return;
    }
    this.#publish(card);
  }

  /**
   * Paint what this device last displayed for the Annotation while its saved
   * pixels resolve, which is what a card shows after a remount and after an
   * application restart instead of nothing at all.
   *
   * A key a read has already answered keeps its answer: the stored image is the
   * fallback, never a replacement for one the display holds.
   */
  async #seed(slot: Slot): Promise<void> {
    const stored = await this.#deps.stored(slot.latest);
    if (!stored) return;
    if (this.#slots.get(slot.hash) !== slot) return;
    if (this.#deps.queries.peek(slot.key) !== null) return;
    this.#deps.queries.client.setQueryData<AvailableExcerpt>(slot.key, stored);
    this.#notify(slot);
  }

  /**
   * Replace one Annotation's pixels while nothing displays it, through the same
   * resolution a card uses and so the same shared PDF queue.
   *
   * The device-local image the Annotation has now is what says whether it is
   * worth replacing at all, and a later saved edit replaces this work rather
   * than joining it, so only the newest pixels reach the store.
   */
  async #replaceStored(request: ExcerptRequest): Promise<void> {
    const annotation = excerptAnnotationRecord(request);
    this.#refreshes.get(annotation)?.abort();
    const refresh = new AbortController();
    this.#refreshes.set(annotation, refresh);
    try {
      const stored = await this.#deps.stored(request);
      if (!stored || stored.identity.key === excerptKey(request)) return;
      await this.#deps.resolve(request, refresh.signal);
    } catch (error) {
      if (!refresh.signal.aborted)
        logger.debug("Stored excerpt replacement failed", {
          annotationKey: request.annotation.key,
          error,
        });
    } finally {
      if (this.#refreshes.get(annotation) === refresh)
        this.#refreshes.delete(annotation);
    }
  }

  /** Give up one card's demand, releasing the read once no card wants it. */
  #leave(card: Card): void {
    const slot = card.slot;
    if (!slot) return;
    card.slot = null;
    slot.cards.delete(card);
    if (slot.cards.size > 0) return;
    this.#slots.delete(slot.hash);
    this.#drop(slot);
  }

  /**
   * Release one Annotation's display read: the key goes, and with it the
   * request snapshot the slot held and any resolution still running for it.
   */
  #drop(slot: Slot): void {
    slot.read = null;
    this.#deps.queries.client.removeQueries({ queryKey: slot.key });
  }

  /**
   * Read what the slot's latest request asks for, or join the read that already
   * asks it: one resolution answers every demand for the same saved pixels.
   */
  #read(slot: Slot): void {
    const wanted = excerptKey(slot.latest);
    const running = slot.read?.excerpt ?? null;
    if (running === wanted) return;
    if (running === null && this.#held(slot) === wanted) return;
    this.#start(slot);
  }

  /**
   * Read the slot's latest request again, whatever it already asks or holds:
   * the explicit Refresh gesture, under which the PDF behind an unchanged
   * request may have been replaced.
   */
  #readAgain(slot: Slot): void {
    this.#start(slot);
  }

  /**
   * Start one read, dropping what stands for the key first: the client cancels
   * the read the slot was running, so a superseded result cannot publish, and
   * the drop ends the failure cooldown of the key an edit or a gesture re-arms.
   */
  #start(slot: Slot): void {
    const wanted = excerptKey(slot.latest);
    this.#deps.queries.invalidate(slot.key);
    const settled = this.#deps.queries.read<AvailableExcerpt>(
      slot.key,
      (context) => this.#resolve(slot, context),
    );
    const reading = { excerpt: wanted, settled };
    slot.read = reading;
    void settled.finally(() => {
      if (slot.read !== reading) return;
      slot.read = null;
      this.#notify(slot);
    });
  }

  /** The excerpt key of what the slot holds, `null` where it holds nothing. */
  #held(slot: Slot): string | null {
    return (
      this.#deps.queries.peek<AvailableExcerpt>(slot.key)?.value.identity.key ??
      null
    );
  }

  /**
   * One resolution of the slot's current request. The request is read when the
   * resolution starts, so a resolution always answers a request some card asked
   * for, and a display that moves on cancels it before it can commit.
   *
   * An unavailable outcome is a failed read: the Held Read keeps the image it
   * already has, which is what the card goes on painting.
   */
  async #resolve(
    slot: Slot,
    context: QueryFunctionContext,
  ): Promise<AvailableExcerpt> {
    const request = slot.latest;
    const outcome = await this.#deps.resolve(request, context.signal);
    if (outcome.kind === "unavailable") {
      logger.debug("Excerpt display has no image", {
        annotationKey: request.annotation.key,
      });
      throw new ExcerptUnavailable(request.annotation.key);
    }
    return outcome;
  }

  #snapshot(card: Card): ExcerptImageDisplay {
    const slot = card.slot;
    // A demand a card has not stated yet is the commit that mounts it, and one
    // whose display a clear released holds nothing: both paint no image, and
    // neither is still reading one. They are not the same state for the card:
    // after a failed read the card keeps painting the last image it held, while
    // a clear removed that image, so a cleared card says so and releases it.
    if (!slot || !card.demand)
      return {
        image: null,
        current: false,
        status: card.demand ? "cleared" : card.stated ? "absent" : "reading",
      };
    const request = card.demand;
    const held = this.#deps.queries.peek<AvailableExcerpt>(slot.key);
    if (!held)
      return {
        image: null,
        current: false,
        status: slot.read === null ? "failed" : "reading",
      };
    return {
      image: held.value,
      current: held.value.identity.key === excerptKey(request),
      status:
        held.status === "revalidating"
          ? "reading"
          : held.status === "failed"
            ? "failed"
            : "settled",
    };
  }

  #notify(slot: Slot): void {
    for (const card of slot.cards) this.#publish(card);
  }

  #publish(card: Card): void {
    card.held = null;
    for (const listener of card.listeners) listener();
  }
}
