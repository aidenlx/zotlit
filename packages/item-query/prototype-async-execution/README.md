# PROTOTYPE — Item Query asynchronous execution

Throwaway code for [#593](https://github.com/aidenlx/zotlit/issues/593) on the
Item Query map [#591](https://github.com/aidenlx/zotlit/issues/591). It lives on
the `prototype/item-query-async-execution` branch only.

## Question

Does a chunked Item Query plan stay responsive and cancellable on Obsidian's
renderer thread? The prototype measures hydration batch size, pause
placement, the pause method, limit and truncation behavior, source-lease
lifetime, and cancellation latency against representative Libraries.

The physical plan (#592) is not chosen yet. The executor therefore runs the
three plan families from the SQLite access-path research as one switch:
`item-led`, `predicate-led`, and `snapshot`. The scheduling layer is the same
for each family.

## Files

| File | Role |
| --- | --- |
| `executor.ts` | The liftable part: a chunked, cancellable executor over `node:sqlite`. Records every synchronous slice. |
| `bench-core.ts` | Experiment matrix and measurement probes. Host-independent. |
| `bench-node.ts` | Runs the matrix in Node. |
| `bench-renderer.ts` | Runs the same matrix inside a running Obsidian window through the Obsidian CLI. |
| `parity.ts` | Confirms that every knob combination returns the same Query Result. |
| `prepare-libraries.ts` | Copies Libraries into `.scratch/libraries/` and builds a 10× scaled Library. |
| `render-report.ts` | Builds `prototype-item-query-async-execution.html` (`ui.en.json`, `story.json`) and the Chinese `prototype-item-query-async-execution.zh.html` (`ui.zh.json`, `story.zh.json`) from `results/`. |
| `results/` | Measured timings and counts. They contain no Item data. |

## Run

Open `prototype-item-query-async-execution.html` (or `.zh.html` for Chinese) in a browser to explore the
recorded results. To measure again:

```sh
LEGACY_DB=/path/to/legacy.sqlite node prepare-libraries.ts   # PROTOTYPE copies — wipe .scratch/ after
node parity.ts
node --expose-gc bench-node.ts --reps=5
OBSIDIAN_CLI=/path/to/checkout/packages/scripts/scripts/obsidian-cli.ts node bench-renderer.ts --reps=3
node render-report.ts
```

`bench-renderer.ts` needs a running Obsidian window that is visible on screen.
It only reads the copies in `.scratch/libraries/`.

## Verdict

Measured on 2026-10-04: macOS arm64, Node 26.5.1 (SQLite 3.53.3), and Obsidian
1.14 on Electron 43.3.0 (Node 24.18.1, SQLite 3.53.1). The Libraries had 9,232,
24,352, and 92,320 top-level Items.

Yes, chunked execution on the renderer thread stays responsive and
cancellable, under these conditions:

1. **Pause with a macrotask, not `scheduler.yield()`.** In the Obsidian
   window, `scheduler.yield()` continuations run before timer tasks. Timers
   could not run for the full query, and a timer-delivered cancel request
   never stopped it. A `MessageChannel` pause cost about 15% more time and
   cancelled in 14–19 ms in all six runs. `setTimeout(0)` also cancelled
   reliably but cost about 60% more. `setImmediate` missed 2 of 6. (In Node,
   `MessageChannel` itself starves timers, so the Node bench uses
   `setImmediate`.)
2. **Yield on an 8 ms budget, and read 250–500 Items per statement.** The
   longest slice then stays at 8–12 ms. Budgets of 16 ms or more drop frames.
3. **Make every in-memory phase pausable.** One `Array.sort` over 85,080 rows
   blocked for up to 213 ms. A top-K buffer (limited queries) and sorted runs
   with a pausable merge (unlimited queries) keep slices under 12 ms. The
   projection loop must pause too.
4. **Accept one unsplittable SQL statement, and bound it.** `ORDER BY
   dateModified` has no index, so the first cursor step sorts in one block:
   4 ms at 9k, 13 ms at 24k, 29 ms at 92k Items. The SQL order lets a limited
   query stop after `limit + 1` matches (31 ms against 72 ms for in-memory
   top-K). Pull candidates in chunks; reading all at once doubles the block.
5. **Truncation:** request `limit + 1`; report `truncated` from it. Apply late
   projection to limited queries only.
6. **Source lease:** release it after the last database read. This cut lease
   time for the 92k export by about 40%.
7. **Cancellation latency is one slice** (2–23 ms with a timer-friendly
   pause). It cannot interrupt one SQL statement.

Open for #596: an unlimited 85,080-row export with six fields peaked at about
245 MB of heap in Node. The complete Query Result contract causes this, not
the scheduler.

Not measured: cancellation delivered by Obsidian CLI IPC or by user input
(the probe used a timer task), Windows and Linux hosts, and a Library with
heavy group-Library skew. The scaled Library repeats the active Library ten
times, so its value distributions are not natural.
