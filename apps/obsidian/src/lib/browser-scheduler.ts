import { MixedScheduler } from "effect/Scheduler";

/**
 * Runs `task` on Chromium's task queue; the returned function cancels it.
 * Node-integrated Obsidian also has Node's setImmediate, which Effect and
 * React's scheduler otherwise select, and which can starve browser messages
 * and browser timers even when the indexing fibers yield.
 */
export function scheduleBrowserTask(task: () => void): () => void {
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
}

/** Dispatch on Chromium's task queue in Node-integrated Obsidian. */
export const browserScheduler = new MixedScheduler(
  "async",
  scheduleBrowserTask,
);
