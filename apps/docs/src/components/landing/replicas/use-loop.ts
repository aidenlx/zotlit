// The landing's loop rule: a replica's loop runs while the replica crosses the
// middle band of the viewport and rests elsewhere, so at most one loop plays at
// a time. It rests on its finished frame: in the prerendered HTML, without
// JavaScript, out of view, and under reduced motion.
// @see apps/docs/DESIGN.md → Motion (Loops)

import { useEffect, useState } from "react";
import type { RefObject } from "react";

/** The loop now playing; a new one takes the band from it. */
let playing: symbol | null = null;
const stops = new Map<symbol, () => void>();

/**
 * Steps through `durations` (ms per frame) while `ref` crosses the middle band.
 * Returns the frame to draw; the last frame is the finished one. Pass a
 * module-level constant: a new array restarts the loop.
 */
export function useLoop(
  ref: RefObject<HTMLElement | null>,
  durations: readonly number[],
): number {
  const last = durations.length - 1;
  const [frame, setFrame] = useState(last);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const me = Symbol("loop");
    let timer = 0;
    let at = 0;
    const stop = () => {
      window.clearTimeout(timer);
      timer = 0;
      if (playing === me) playing = null;
      setFrame(durations.length - 1);
    };
    const tick = () => {
      at = (at + 1) % durations.length;
      setFrame(at);
      timer = window.setTimeout(tick, durations[at]);
    };
    const start = () => {
      if (reduced.matches || timer) return;
      if (playing && playing !== me) stops.get(playing)?.();
      playing = me;
      at = 0;
      setFrame(0);
      timer = window.setTimeout(tick, durations[0]);
    };
    stops.set(me, stop);
    const io = new IntersectionObserver(
      ([entry]) => (entry?.isIntersecting ? start() : stop()),
      { rootMargin: "-40% 0px -40% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      stop();
      stops.delete(me);
    };
  }, [ref, durations]);

  return frame;
}
