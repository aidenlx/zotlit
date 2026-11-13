// The browser's viewport and playback boundary for recording tests, which happy-dom lacks.

/** Where a target sits in the window: its top edge and height, in CSS pixels. */
export interface Box {
  top: number;
  height: number;
}

/** A box below the fold, which no observer sees. */
const unplaced: Box = { top: Number.POSITIVE_INFINITY, height: 0 };

/** Places in a window `window.innerHeight` pixels tall. */
export const where = {
  /** Across the middle band of the window, where a recording plays on its own. */
  middle: (): Box => ({
    top: window.innerHeight * 0.45,
    height: window.innerHeight * 0.1,
  }),
  /** A sliver at the bottom edge: in the window, outside its middle band. */
  edge: (): Box => ({ top: window.innerHeight - 20, height: 300 }),
  /** Below the fold. */
  away: (): Box => ({ top: window.innerHeight * 3, height: 300 }),
};

/** Runs the tasks the browser has queued: observer entries and media events, and the ones they queue. */
export async function settle() {
  for (let round = 0; round < 10; round++) {
    await new Promise((done) => setTimeout(done));
  }
}

/** One side of a `rootMargin`, in pixels of a window `size` pixels tall. */
function marginPx(value: string | undefined, size: number) {
  if (!value) return 0;
  const amount = Number.parseFloat(value);
  return value.endsWith("%") ? (amount / 100) * size : amount;
}

/**
 * IntersectionObserver at the browser boundary, as the browser runs it: each
 * observed target gets an initial entry in a later task, and a later entry
 * whenever `place` moves it across a threshold of the observer's root, which
 * is the window shrunk or grown by the vertical `rootMargin`.
 */
export class FakeIntersectionObserver {
  static readonly live = new Set<FakeIntersectionObserver>();
  static readonly #boxes = new WeakMap<Element, Box>();
  readonly #callback: IntersectionObserverCallback;
  readonly #margin: [top: string | undefined, bottom: string | undefined];
  readonly #thresholds: number[];
  /** The last state each target reported: the index of the threshold it met, or -1 out of the root. */
  readonly #reported = new Map<Element, number>();

  constructor(
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.#callback = callback;
    const [top, , bottom = top] = (options.rootMargin ?? "0px").split(/\s+/);
    this.#margin = [top, bottom];
    const { threshold = 0 } = options;
    this.#thresholds = Array.isArray(threshold) ? threshold : [threshold];
    FakeIntersectionObserver.live.add(this);
  }

  observe(target: Element) {
    if (this.#reported.has(target)) return;
    this.#reported.set(target, Number.NaN);
    setTimeout(() => this.#report(target));
  }

  unobserve(target: Element) {
    this.#reported.delete(target);
  }

  disconnect() {
    this.#reported.clear();
    FakeIntersectionObserver.live.delete(this);
  }

  takeRecords() {
    return [];
  }

  /** Sends `target`'s entry when its state differs from the last one sent; the first always goes. */
  #report(target: Element) {
    const last = this.#reported.get(target);
    if (last === undefined) return;
    const box = FakeIntersectionObserver.#boxes.get(target) ?? unplaced;
    const size = window.innerHeight;
    const rootTop = -marginPx(this.#margin[0], size);
    const rootBottom = size + marginPx(this.#margin[1], size);
    const visible = Math.max(
      0,
      Math.min(rootBottom, box.top + box.height) - Math.max(rootTop, box.top),
    );
    const isIntersecting = visible > 0;
    const intersectionRatio =
      isIntersecting && box.height > 0 ? visible / box.height : 0;
    const state = isIntersecting
      ? this.#thresholds.filter((t) => intersectionRatio >= t).length
      : -1;
    if (state === last) return;
    this.#reported.set(target, state);
    const entry = {
      target,
      isIntersecting,
      intersectionRatio,
    } as IntersectionObserverEntry;
    this.#callback([entry], this as unknown as IntersectionObserver);
  }

  /** Moves `target` in the window; every observer watching it reports in a later task. */
  static place(target: Element, box: Box) {
    FakeIntersectionObserver.#boxes.set(target, box);
    for (const observer of FakeIntersectionObserver.live) {
      if (observer.#reported.has(target)) {
        setTimeout(() => observer.#report(target));
      }
    }
  }
}

/**
 * Media events in the browser's timing, for the lifetime of the returned
 * disposable: `play()` and `pause()` change `paused` at once and fire their
 * events in a later task, as a browser queues them. happy-dom fires them
 * inside the call.
 */
export function queueMediaEvents(): Disposable {
  const proto = HTMLMediaElement.prototype;
  const keys = ["play", "pause", "dispatchEvent"] as const;
  const own = keys.map(
    (key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const,
  );
  const [play, pause, dispatchEvent] = keys.map(
    (key) => Reflect.get(proto, key) as (...args: unknown[]) => unknown,
  ) as [
    (...args: unknown[]) => unknown,
    (...args: unknown[]) => unknown,
    (...args: unknown[]) => unknown,
  ];
  const queuing = new Set<EventTarget>();
  function inCall<T>(element: HTMLMediaElement, call: () => T) {
    queuing.add(element);
    try {
      return call();
    } finally {
      queuing.delete(element);
    }
  }
  proto.play = function (this: HTMLMediaElement) {
    return inCall(this, () => Reflect.apply(play, this, []) as Promise<void>);
  };
  proto.pause = function (this: HTMLMediaElement) {
    inCall(this, () => Reflect.apply(pause, this, []));
  };
  proto.dispatchEvent = function (this: HTMLMediaElement, event: Event) {
    if (!queuing.has(this)) {
      return Reflect.apply(dispatchEvent, this, [event]) as boolean;
    }
    setTimeout(() => Reflect.apply(dispatchEvent, this, [event]));
    return true;
  };
  return {
    [Symbol.dispose]() {
      for (const [key, descriptor] of own) {
        if (descriptor) Object.defineProperty(proto, key, descriptor);
        else Reflect.deleteProperty(proto, key);
      }
    },
  };
}

/**
 * Plays `video` to its end as a browser does for a clip without `loop`: it
 * reports `ended`, fires `pause`, then `ended`. The next `play` starts the
 * clip again from its start, so it no longer reports `ended`. happy-dom never
 * reaches the end of a clip on its own.
 */
export function endPlayback(video: HTMLVideoElement) {
  let over = true;
  Object.defineProperty(video, "ended", {
    configurable: true,
    get: () => over,
  });
  const play = video.play.bind(video);
  video.play = () => {
    over = false;
    return play();
  };
  video.pause();
  setTimeout(() => video.dispatchEvent(new Event("ended")));
}
