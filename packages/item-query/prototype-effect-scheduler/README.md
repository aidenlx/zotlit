# PROTOTYPE — Effect scheduler in the Obsidian window

Throwaway code for [#1313](https://github.com/aidenlx/zotlit/issues/1313) on the
Item Query map [#591](https://github.com/aidenlx/zotlit/issues/591). It lives on
the `prototype/item-query-effect-scheduler` branch only.

## Question

Does an Effect v4 fiber under a custom `MessageChannel` scheduler with an 8 ms
time budget meet the accepted performance criteria (#596) inside an Obsidian
window, on Libraries of 10,000, 50,000, and 100,000 Items?

## Files

| File | Role |
| --- | --- |
| `scheduler.ts` | The liftable part. `BudgetScheduler` extends Effect's `MixedScheduler` and overrides only `shouldYield` with a time budget. The pause is a parameter. `Recorder` times every slice. |
| `executor-effect.ts` | The #593 executor ported to Effect: one `Effect.try` for each SQL statement, one `Effect.sync` for each in-memory chunk, no pause calls. Database as a service, cancellation as interruption, lease and cursor in finalizers. |
| `bench.ts` | The matrix. It is bundled to CommonJS and loaded in the Obsidian window with `require`. |
| `run-renderer.ts` | Bundles `bench.ts`, runs it per tier through the Obsidian CLI, then sends cancel requests as a second CLI call. |
| `prepare-libraries.ts` | Builds the three tiers in `.scratch/libraries/` from the active Zotero Library. |
| `summarize.ts` | Writes `results/summary.md` from `results/`. |
| `size-effect.ts`, `size-plain.ts` | Bundle-size probes. |
| `results/` | Timings, counts, and a result hash. No Item data. |

The plain executor in `../prototype-async-execution/` is the comparison. This
branch only adds `export` to its helpers.

## Run

```sh
node prepare-libraries.ts                       # PROTOTYPE copies — wipe .scratch/ after
M=/path/to/checkout                             # a checkout with installed dependencies
OBSIDIAN_CLI=$M/packages/scripts/scripts/obsidian-cli.ts \
ESBUILD=$M/apps/obsidian/node_modules/.bin/esbuild \
NODE_PATH=$M/apps/obsidian/node_modules \
  node run-renderer.ts vault=<id> --reps=5
node summarize.ts
```

Keep the Obsidian window visible on screen during the run.

## Engines

| Engine | Scheduler | Pause | Budget |
| --- | --- | --- | --- |
| `plain-mc8` | #593 executor, explicit pauses | `MessageChannel` | 8 ms |
| `effect-mc8` | `BudgetScheduler` (the candidate) | `MessageChannel` | 8 ms |
| `effect-st8` | `BudgetScheduler` | `setTimeout(0)` | 8 ms |
| `effect-si8` | `BudgetScheduler` | `setImmediate` | 8 ms |
| `effect-mc4` | `BudgetScheduler` | `MessageChannel` | 4 ms |
| `effect-default` | `MixedScheduler` as shipped | `setImmediate` | 2,048 operations |

Plan path for every engine (#596): unordered item-led scan, 500 candidates for
each pull, 250 Items for each hydration statement, top-K for limited queries,
chunked sort and projection, late projection, early lease release. Simulated
renderer work (3 ms every 16 ms) runs during every query.

## Verdict

Measured on 2026-10-04: macOS arm64, Obsidian 1.14 on Electron 43.3.0 (Node
24.18.1, SQLite 3.53.1), window visible. Full numbers: `results/summary.md`.

**Yes. The Effect fiber with the `MessageChannel` scheduler and an 8 ms budget
meets the criteria. It is as fast as the plain executor.**

1. **Slices.** At all three tiers, with all six queries, the longest
   `effect-mc8` slice was 8–14 ms, the same as the plain executor. The
   exception is one SQL statement (item 5). In 1 of 15 export runs at 100k, three
   slices near the start of the scan were 17, 43, and 54 ms. Ten more runs
   of each engine did not show this again. The cause is not known; the
   scan phase runs the same SQL and evaluator code in both engines.
2. **Cancellation.** A timer-delivered cancel request stopped the Effect
   query in 8–24 ms at every tier, in all 78 runs that the request reached
   before the end (criterion: 50 ms; plain: 9–22 ms). The time is the wait
   for the current slice and the timer task. After the signal fires, the
   fiber settles in at most 3.2 ms: Effect interrupts a paused fiber
   synchronously in the abort listener.
3. **Total time.** Effect against plain, median of five runs: 0.94–1.08 at
   every tier and query, with one outlier of 1.24 (a 9 ms query at 10k).
   The 100k export took 1,062 ms against 1,050 ms. The accepted time
   budgets of #596 stand.
4. **The default scheduler fails.** `setImmediate` exists in the renderer,
   so the shipped `MixedScheduler` pauses with it. It pauses only after
   2,048 operations, and one Item Query run has fewer operations than that,
   because each operation is a whole SQL statement or chunk. The 10k export
   ran as one 104–127 ms slice, the 100k export had slices up to 416 ms, and
   no cancel request took effect before the end. Always pass the budget
   scheduler.
5. **One SQL statement cannot be split.** For the rare-tag and common-tag
   queries, the item-led plan pushes the tag test into the candidate
   statement. The first pull of 500 candidates then scans until it finds
   them: 15.6 ms at 100k for the rare tag (Node, alone), and 16–18 ms
   slices in the window for both engines. This is a physical-plan
   question for #592 (a reverse-index candidate set for selective exact
   leaves avoids the scan), not a scheduler question.
6. **Cancel through the Obsidian CLI.** All 120 CLI cancel requests stopped
   the query. With no query running, the call path (CLI start-up and IPC)
   takes 80–91 ms. With a query running, it took a median of about 108 ms,
   so the query adds about 25 ms. Two plain-executor runs at 50k took 194
   and 230 ms; the Effect engine stayed at 91–144 ms. When the request
   arrives, the Effect query settles in at most 3.2 ms (29 of 30 runs: less
   than 0.5 ms).
7. **Alternative pauses.** All three pass with an 8 ms budget. `setTimeout(0)`
   costs 33–55% more total time. `setImmediate` costs 0–5% more, except 21%
   on the 10k title search, and its cancel latency was the shortest
   (3–14 ms). A 4 ms `MessageChannel` budget keeps slices at 4–8 ms for
   0–7% more total time (20% on the 10k title search). `MessageChannel` stays the
   choice: it passes, and #593 showed `setImmediate` missing cancel
   requests.
8. **Bundle size.** The Effect engine with the adapter calls
   (`runPromiseExit`, `Exit`, `Cause.squash`, `Context`, `Data`) bundles
   to 99.6 KB minified against 9.1 KB for the plain executor. Effect adds
   about 90 KB minified, 31 KB with gzip, from 52 modules. The current
   plugin `main.js` is about 2.6 MB, so the increase is about 3.5%.

**Not measured:** Windows and Linux hosts; cancel by user input; the real
evaluator and the hybrid plan of #595; a test scheduler (verification
strategy ticket).
