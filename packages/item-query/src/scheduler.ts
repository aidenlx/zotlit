import { Context } from "effect";
import type { Fiber } from "effect";
import { MixedScheduler } from "effect/Scheduler";

/** The time one slice of a query may run before the fiber pauses. */
export const SLICE_BUDGET_MS = 8;

/**
 * Hands control back to the host and calls `resume` in a later task. The
 * returned function cancels the call.
 */
export type Pause = (resume: () => void) => () => void;

export interface ItemQuerySchedulerOptions {
  /** Defaults to {@link SLICE_BUDGET_MS}. */
  budgetMs?: number;
  /** A monotonic time in milliseconds. Defaults to `performance.now`. */
  now?: () => number;
  /** Defaults to a `MessageChannel` task. */
  pause?: Pause;
}

/**
 * Receives the end and the start of each slice. The times come from the clock
 * of the scheduler, `performance.now` by default.
 */
export interface SliceObserver {
  /** The fiber ends a slice and hands control back to the host. */
  paused(at: number): void;
  /** The fiber starts its next slice. */
  resumed(at: number): void;
}

/**
 * Receives each pause of `ItemQueryScheduler` in a run. The default does
 * nothing. A test or a measurement provides an observer to count pauses and
 * to time slices; the Obsidian adapter provides none.
 */
export const ItemQuerySliceObserver = Context.Reference<SliceObserver>(
  "@zotlit/item-query/ItemQuerySliceObserver",
  { defaultValue: () => ({ paused: () => {}, resumed: () => {} }) },
);

/** The slice in progress, and the observer of the fiber that paused last. */
interface Slice {
  start: number | undefined;
  observer: SliceObserver | undefined;
}

/**
 * The scheduler every Item Query run uses: Effect's default scheduler, with its
 * operation-count yield test replaced by a time budget and its pause replaced
 * by a `MessageChannel` task. Pass it as the `scheduler` run option. The engine
 * has no pause calls of its own; this scheduler alone ends a slice.
 *
 * Effect's default scheduler pauses after 2,048 operations, which one query
 * rarely reaches, so a query under it runs as one slice that blocks the
 * Obsidian window.
 *
 * Create one scheduler for each run: the slice in progress is its state.
 */
export class ItemQueryScheduler extends MixedScheduler {
  readonly #budgetMs: number;
  readonly #now: () => number;
  readonly #slice: Slice;

  constructor(options: ItemQuerySchedulerOptions = {}) {
    const now = options.now ?? (() => performance.now());
    const pause = options.pause ?? messageChannelPause();
    const slice: Slice = { start: undefined, observer: undefined };
    super("async", (resume) =>
      pause(() => {
        slice.start = now();
        slice.observer?.resumed(slice.start);
        resume();
      }),
    );
    this.#budgetMs = options.budgetMs ?? SLICE_BUDGET_MS;
    this.#now = now;
    this.#slice = slice;
  }

  override shouldYield(fiber: Fiber.Fiber<unknown, unknown>): boolean {
    const now = this.#now();
    if (this.#slice.start === undefined) {
      this.#slice.start = now;
      return false;
    }
    if (now - this.#slice.start < this.#budgetMs) return false;
    this.#slice.observer = fiber.getRef(ItemQuerySliceObserver);
    this.#slice.observer.paused(now);
    return true;
  }
}

/**
 * A pause that resumes in a `MessageChannel` task. The window handles input
 * and rendering before that task, and no timer clamp delays it.
 *
 * The channel is open only while a resume waits. An open port with a listener
 * stays in memory in the Obsidian window and keeps a Node process alive.
 */
export function messageChannelPause(): Pause {
  let channel: MessageChannel | undefined;
  const waiting: { resume: () => void; live: boolean }[] = [];

  const open = (): MessageChannel => {
    const opened = new MessageChannel();
    opened.port1.onmessage = () => {
      const next = waiting.shift();
      if (waiting.length === 0) {
        opened.port1.close();
        channel = undefined;
      }
      if (next?.live) next.resume();
    };
    return opened;
  };

  return (resume) => {
    channel ??= open();
    const entry = { resume, live: true };
    waiting.push(entry);
    channel.port2.postMessage(0);
    return () => {
      entry.live = false;
    };
  };
}
