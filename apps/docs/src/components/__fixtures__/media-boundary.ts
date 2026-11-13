// The browser's viewport and playback boundary for recording tests, which happy-dom lacks.

/**
 * IntersectionObserver at the browser boundary. `show` reports a target's
 * visible ratio to every observer that watches it.
 */
export class FakeIntersectionObserver {
  static readonly live = new Set<FakeIntersectionObserver>();
  readonly #targets = new Set<Element>();
  readonly #callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.#callback = callback;
    FakeIntersectionObserver.live.add(this);
  }

  observe(target: Element) {
    this.#targets.add(target);
  }

  unobserve(target: Element) {
    this.#targets.delete(target);
  }

  disconnect() {
    this.#targets.clear();
    FakeIntersectionObserver.live.delete(this);
  }

  takeRecords() {
    return [];
  }

  static show(target: Element, ratio: number) {
    for (const observer of [...FakeIntersectionObserver.live]) {
      if (!observer.#targets.has(target)) continue;
      const entry = {
        target,
        isIntersecting: ratio > 0,
        intersectionRatio: ratio,
      } as IntersectionObserverEntry;
      observer.#callback([entry], observer as unknown as IntersectionObserver);
    }
  }
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
  video.dispatchEvent(new Event("ended"));
}
