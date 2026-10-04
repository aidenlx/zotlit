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
  readonly #slice: { start: number | undefined };

  constructor(options: ItemQuerySchedulerOptions = {}) {
    const now = options.now ?? (() => performance.now());
    const pause = options.pause ?? messageChannelPause();
    const slice: { start: number | undefined } = { start: undefined };
    super("async", (resume) =>
      pause(() => {
        slice.start = now();
        resume();
      }),
    );
    this.#budgetMs = options.budgetMs ?? SLICE_BUDGET_MS;
    this.#now = now;
    this.#slice = slice;
  }

  override shouldYield(): boolean {
    const now = this.#now();
    if (this.#slice.start === undefined) {
      this.#slice.start = now;
      return false;
    }
    return now - this.#slice.start >= this.#budgetMs;
  }
}

/**
 * A pause that resumes in a `MessageChannel` task. The window handles input
 * and rendering before that task, and no timer clamp delays it.
 */
export function messageChannelPause(): Pause {
  let channel: MessageChannel | undefined;
  const waiting: { resume: () => void; live: boolean }[] = [];

  // Node keeps a process alive for a port that listens. Hold the port only
  // while a resume waits; a browser port has no such handle.
  const hold = (port: MessagePort, held: boolean) => {
    const handle = port as { ref?(): void; unref?(): void };
    if (held) handle.ref?.();
    else handle.unref?.();
  };

  const open = (): MessageChannel => {
    const opened = new MessageChannel();
    opened.port1.onmessage = () => {
      const next = waiting.shift();
      if (waiting.length === 0) hold(opened.port1, false);
      if (next?.live) next.resume();
    };
    return opened;
  };

  return (resume) => {
    channel ??= open();
    const entry = { resume, live: true };
    waiting.push(entry);
    hold(channel.port1, true);
    channel.port2.postMessage(0);
    return () => {
      entry.live = false;
    };
  };
}
