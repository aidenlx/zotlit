import { MixedScheduler } from "effect/Scheduler";

/**
 * Dispatch on Chromium's task queue in Node-integrated Obsidian.
 * Effect otherwise selects Node's setImmediate, which can starve browser
 * messages and browser timers even when the indexing fibers yield.
 */
export const browserScheduler = new MixedScheduler("async", (task) => {
  const { port1, port2 } = new MessageChannel();
  const close = () => {
    port1.onmessage = null;
    port1.close();
    port2.close();
  };
  port1.onmessage = () => {
    close();
    task();
  };
  port2.postMessage(null);
  return close;
});
