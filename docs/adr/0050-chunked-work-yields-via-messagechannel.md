# Chunked work yields via MessageChannel, not setTimeout or scheduler.yield

Long batch loops (e.g. `classifyChunked` in `batch-run.ts`) yield between fixed-size slices so the loading bar paints and Cancel stays responsive. We standardize that yield on a `MessageChannel`-based primitive — post a message and await its delivery — rather than the obvious `setTimeout(0)` or the newer `scheduler.yield()`. A `MessageChannel` callback is a normal macrotask that Chromium does **not** subject to timer throttling and does **not** reorder ahead of pending timers, so it drains a chunk queue promptly even when the Obsidian window is backgrounded while leaving other scheduled work alone.

## Considered Options

- **`setTimeout(0)`** (the current `delay(0)` in `classifyChunked`) — Obsidian is Electron/Chromium, which throttles timers in a backgrounded window: nested `setTimeout` is clamped to ≥4ms and a backgrounded page is clamped toward ~1s. A multi-thousand-item batch that yields via `setTimeout` between 50-item slices collapses to roughly one slice per second the moment the user switches away, turning a fast run into a stalled one. **Rejected.**
- **`scheduler.yield()`** — yields with continuation priority so the loop resumes ahead of same-priority tasks. That very priority starves lower-priority timer callbacks: unrelated `setTimeout`/interval work in the plugin and other plugins is postponed behind our continuation for the duration of the batch. We want to yield the main thread, not monopolize it. **Rejected.**
- **`MessageChannel.postMessage`** — a plain macrotask, immune to timer throttling and non-privileged over timers. It gives prompt resumption in the background without starving anything. **Chosen.**

## Consequences

- The `await delay(0)` yield points in chunked loops move to the shared `MessageChannel` primitive; `delay`/`setTimeout` remain fine for actual *delays* (backoff, debounce), where wall-clock time is the point.
- Background responsiveness is now a tested property of batch runs, not incidental to whether the window happens to be focused.
