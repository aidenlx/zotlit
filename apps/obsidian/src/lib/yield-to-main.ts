/**
 * Macrotask yield so the host UI stays interactive between chunks of
 * synchronous work. Uses a `MessageChannel` message task rather than a timer
 * or `scheduler.yield()`: `setTimeout`/Obsidian's `sleep` are clamped and
 * background-throttled in hidden/occluded Chromium windows (stretching a
 * chunked run from seconds to minutes), while `scheduler.yield()`
 * continuations outrank normal tasks and starve the host's own timers for the
 * run's duration. Message tasks run unthrottled at normal priority,
 * interleaving fairly with rendering, input, and timers — and work
 * identically under Node (Vitest), so no test-only branch or mock is needed.
 */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      port2.close();
      resolve();
    };
    port2.postMessage(null);
  });
}
