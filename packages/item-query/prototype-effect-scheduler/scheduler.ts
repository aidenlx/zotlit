/**
 * PROTOTYPE — throwaway. The Effect v4 scheduler under test for #1313: Effect's
 * own `MixedScheduler` with a time budget in place of its 2,048-operation
 * count, and a pluggable pause. A Recorder wraps the pause so the bench sees
 * every synchronous slice the fiber runs, for the default scheduler too.
 */
import { MixedScheduler } from "effect/Scheduler";

export type Pause = (f: () => void) => () => void;

/** Times every slice: the fiber runs only inside the paused callback, or in the first synchronous step. */
export class Recorder {
  sliceStart: number;
  slices: [number, number][] = [];
  constructor(readonly now: () => number) {
    this.sliceStart = now();
  }
  wrap(pause: Pause): Pause {
    return (f) =>
      pause(() => {
        this.sliceStart = this.now();
        f();
        this.slices.push([this.sliceStart, this.now()]);
      });
  }
}

/** Pauses after `budgetMs` of fiber work instead of after a count of operations. */
export class BudgetScheduler extends MixedScheduler {
  constructor(
    readonly recorder: Recorder,
    readonly budgetMs: number,
    pause: Pause,
  ) {
    super("async", recorder.wrap(pause));
  }
  override shouldYield(): boolean {
    return this.recorder.now() - this.recorder.sliceStart >= this.budgetMs;
  }
}

/** Effect's default scheduler with only the slice recording added. */
export const defaultScheduler = (recorder: Recorder, pause: Pause) =>
  new MixedScheduler("async", recorder.wrap(pause));

export function messageChannelPause(): { pause: Pause; close(): void } {
  const channel = new MessageChannel();
  const queue: { f: () => void; live: boolean }[] = [];
  channel.port1.onmessage = () => {
    const next = queue.shift();
    if (next?.live) next.f();
  };
  return {
    pause: (f) => {
      const entry = { f, live: true };
      queue.push(entry);
      channel.port2.postMessage(0);
      return () => {
        entry.live = false;
      };
    },
    close: () => channel.port1.close(),
  };
}

export const setTimeoutPause: Pause = (f) => {
  const t = setTimeout(f, 0);
  return () => clearTimeout(t);
};

export const setImmediatePause: Pause = (f) => {
  const t = setImmediate(f);
  return () => clearImmediate(t);
};
