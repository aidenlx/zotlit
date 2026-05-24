# HANDOFF — `@zotlit/item-lookup` bench / tuner stage

## Goal

Build the bench/tuner harness inside `packages/item-lookup/bench/` so we can
empirically tune `ScoringConfig` against the 1287-item real Zotero sqlite at
`/Users/aidenlx/repo/zotlit-repo/1287.zotero.migrated.sqlite`.

The previous stage extracted the search engine into a workspace package and
made `ScoringConfig` injectable. This stage exercises that capability with a
judge set, metrics, and a config sweep.

## What's already done — DO NOT redo

Commit `5d58e28` (on `feat/search`) — refactor(item-lookup): extract engine
into `@zotlit/item-lookup` package.

- Package `@zotlit/item-lookup` exists at `packages/item-lookup/` with `.` and
  `/fixtures` subpath exports. tsdown build, vitest tests, oxlint config —
  matches `@zotlit/db` shape.
- `searchIndex` takes optional `scoring?: ScoringConfig`; `DEFAULT_SCORING` is
  the exported default. `buildIndex` signature unchanged (nothing index-time is
  tunable).
- `ScoringConfig` knobs: `boosts` (per-field MiniSearch boost), `recencyMaxBoost`,
  `recencyHalfLifeDays`, `exactYearBonus`, `fuzzy: (term) => number`, `prefix:
  boolean`. See `packages/item-lookup/src/engine.ts`.
- Engine is `obsidian`-free: local `SearchMatches = [number, number][]` alias;
  `getChsSegmenter(app)` evicted to `apps/obsidian/src/services/item-lookup/
  chs-segmenter.ts`.
- `src/jieba.ts` is an internal-only `ChsSegmenter` wrapping `jieba-wasm`'s
  node entry (sync; no init plumbing). It is **not** in the package barrel and
  **not** in the `exports` map. `jieba-wasm` is a devDep on
  `@zotlit/item-lookup` only — does not propagate to the Obsidian bundle.
- Obsidian service uses the default scoring (no override surfaced to consumers).
- 29 package tests + 166 obsidian tests passing; oxlint clean on the touched
  trees.

## Settled design decisions — DO NOT re-litigate

| Question | Settled |
| --- | --- |
| Bench location | `packages/item-lookup/bench/` (inside the package, not a new workspace) |
| jieba public export? | No — internal `src/jieba.ts` only |
| Wasm path plumbing? | No — jieba-wasm node entry handles it |
| Production segmenter? | Unchanged — Obsidian probes `cm-chs-patch` via `getChsSegmenter` |
| `ScoringConfig` shape | Flat config object, no deep-partial merge. Bench spreads its own overrides from `DEFAULT_SCORING`. |
| Obsidian service config | Hardcoded `DEFAULT_SCORING` — not surfaced to view consumers |
| REPL in this stage | No — bench only (judge-set + metrics + sweep). REPL deferred. |

## Open questions for the bench stage

These are unanswered — the next agent has to pick. Bring them to the user
before building if you want to grill rather than guess.

1. **Judge set source.** Hand-authored `query → expected-itemKey[]` JSON?
   Synthetic from title + creator combinations across all 1287 items? Mined
   from actual user query logs (none collected)? Hand-authored is the
   default — small (20–50 queries), readable in a diff, intentional about
   what cases matter.
2. **Metric choice.** Default to all three diagnostic metrics: MRR, nDCG@10,
   precision@5. Single-metric tuning loses signal about where the engine
   is regressing (e.g. precision up, recall down).
3. **Sweep strategy.** Grid search over each knob holding others at default,
   tabular output. Bayesian optimisation is overkill for ~6 knobs.
4. **Report format.** `console.table` for interactive runs;
   markdown table written to `packages/item-lookup/bench/results/<config>.md`
   for diff-friendly comparison across PRs. Pick one to start.
5. **Corpus snapshot.** Loading 1287 items from sqlite per run is ~100ms.
   Acceptable. Don't pre-snapshot to JSON unless run time becomes a
   bottleneck — adds a refresh-staleness concern.

## What's available

- **Real corpus loader**: `import { getIndexedItemsByLibrary } from "@zotlit/db"`
  + `import { NodeDatabaseClient } from "@zotlit/db/client/node"`. Hand the
  result straight to `buildIndex`.
- **Internal CJK segmenter**: `import { jieba } from "../jieba"` (relative,
  same package — `jieba-wasm` is already a devDep). Pass to `buildIndex` via
  `TokenizerOptions.chsSegmenter` if your judge set has Chinese-titled items.
- **Fixtures for synthetic tests**: `@zotlit/item-lookup/fixtures` exports
  `makeIndexedItem`, `makeItem`, `makeCreator`. Use these if the judge set
  needs deterministic edge cases that aren't in the real DB.
- **Architectural reference**: `search-comparison.md` at worktree root —
  describes Zotero's `quicksearch-titleCreatorYear` parity model and why
  the current scoring shape is what it is. Useful background for *what*
  to tune toward.

## Suggested order

1. Decide judge set format with the user (Q1 above), commit a small initial
   judge-set JSON under `packages/item-lookup/bench/judge-set.json`.
2. Write `bench/corpus.ts` — load `IndexedItem[]` from the real sqlite via
   `@zotlit/db`'s node client. Skip with a clear message if the sqlite is
   absent (matches the pattern in the structural stage's DB tests).
3. Write `bench/metrics.ts` — MRR, nDCG@K, precision@K. Pure functions; unit
   tests against trivial inputs.
4. Write `bench/bench.ts` entrypoint — build the index once, sweep the
   configs the user wants to compare, emit results in the chosen report
   format.
5. Add `"bench": "node --import tsx bench/bench.ts"` (or the repo's tsx
   equivalent — check `packages/scripts` for the existing pattern) to
   `packages/item-lookup/package.json`. Keep `bench/**` outside the tsdown
   `entry` so it's not built into `dist/`.

## What's been deferred to a later stage

- **REPL / interactive console.** A typing-loop UI for eyeball tuning,
  separate from the metric-driven sweep. Discussed and explicitly skipped
  for this stage too. Add only if metric tuning hits the wall.
- **Disk-persisted index.** Omnisearch-style cache of the built index.
  Build time on 1287 items is well under the empty-query path budget; this
  is the deferred work from `search-comparison.md` §5.4.
- **Tuning the recency curve, left-anchor creator boost, exact-title
  boost.** These are *what the bench tunes for* — don't pre-tune by hand
  ahead of the bench. The whole point is empirical.

## Heads up

- Pre-existing repo issues, unrelated to item-lookup, will show up in a
  full `pnpm typecheck` / `pnpm lint`: `apps/website/src/router.tsx`
  imports a generated `routeTree.gen` (not in git), and
  `packages/db/src/queries/items.ts` has a no-useless-default-assignment
  warning. Both predate this branch.
- `search-comparison.md` is still at worktree root (untracked). It's
  reference reading; leave it untracked unless promoting to docs.
- The previous HANDOFF (structural stage) was overwritten by this one — its
  contents are captured in commits `da579f8` (lean index work) and `5d58e28`
  (this extraction).
