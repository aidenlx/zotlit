# @zotlit/e2e

The End-to-end Run suite — the plugin running in a real desktop Obsidian window, reading the Fixture's Zotero data directory from disk. See `packages/scripts/GLOSSARY.md` for the glossary (Fixture, Fixture Vault, Scope Case, End-to-end Run).

## Commands

- `pnpm e2e` (root) or `pnpm --filter @zotlit/e2e e2e` — runs the suite.
- `pnpm e2e:query` (root) — builds dependencies and runs only the ZotLit Query CLI cases, including cancellation.
- For another focused desktop run, pass a file and test name: `pnpm e2e --project=desktop src/<area>.e2e.ts -t '<test name>'`. Add the paired project only when the changed behavior needs Zotero. After the build is current, `pnpm --filter @zotlit/e2e exec vitest run` accepts the same selection for an inner loop.
- `pnpm --filter @zotlit/e2e typecheck` — type-checks the suite.
- Worker responsiveness: `pnpm e2e:worker` requires desktop Obsidian and passes only when the unchanged refresh, changed-Item rebuild, and rejected-snapshot cases all execute. `pnpm verify --release` runs it after the full End-to-end Run on the desktop. Its worker timer detects stalls that sequential search p99 can hide.

- `pnpm --filter @zotlit/e2e measure:query` — the release-time measurement of ZotLit Query (see below).
- `pnpm --filter @zotlit/e2e test` — unit tests of the measurement record (`src/**/*.test.ts`, `vitest.unit.config.ts`). They touch no Obsidian.

The End-to-end Run and the measurement drive a real Electron app. The `test` script runs the unit tests alone. `pnpm verify --release` requires the full End-to-end Run, including the Paired Run, followed by worker responsiveness on the desktop. GitHub Actions skips the desktop checks; `pnpm release` runs them before the version commit.

## End-to-end Run layout

Shared Fixture setup, vault bootstrap, and helpers live in `src/e2e-run-*.ts` (`e2e-run-fixture.ts`, `e2e-run-lifecycle.ts`, `e2e-run-suite-helpers.ts`, and related modules). Every area file calls `registerEndToEndRunHooks()` so the Fixture vault opens once per run across files.

Add a new case to the area file that matches its feature (create a new area file only when an existing one would pass ~2,000 lines):

| File | Area |
| --- | --- |
| `annotations.e2e.ts` | Annotation View, sidebar grouping, early Query File embeds |
| `annotations-excerpts.e2e.ts` | PDF excerpts, rendering, worker reads |
| `query-file.e2e.ts` | Query File tabs, new-query hotkey |
| `query-view.e2e.ts`, `query-view-properties.e2e.ts`, `query-view-table.e2e.ts` | Query View UI, formulas, table and Items layout |
| `library-view.e2e.ts`, `library-view-navigation.e2e.ts`, `library-view-reading.e2e.ts` | Library View browsing, search, Reading Card |
| `literature-notes.e2e.ts` | Literature Note create/update, profiles, match workbench |
| `local-bridge.e2e.ts` | Local Bridge / web workbench (needs `WEB_WORKBENCH_ENABLED=true`) |
| `follow-mode.e2e.ts` | Follow Mode menu rendering |
| `query-cli*.e2e.ts` | `zotlit:query`, schema, scope CLI |
| `fresh-destination.e2e.ts` | Fresh vault destination flow |
| `window-reload.e2e.ts` | Window reload startup order |

The default reporter prints suite progress, the run's evidence folder, and the final counts. Each run writes its evidence to its own folder, `.scratch/e2e-results/<start time>-<pid>/`, and `.scratch/e2e-results/latest` points to the run that started last. Read `results.json` there for individual results and `console.log` for console evidence. A Paired Run setup failure writes `paired-startup.log` in that folder with the launch error chain. The ten newest run folders stay; copy evidence you need to retain longer. A tool that reads the results of a run it starts sets `ZOTLIT_E2E_RESULTS` to the folder (see `src/verify-worker.ts`).

## Requirements

Needs desktop Obsidian running locally with the CLI enabled (Settings → General → Advanced → "Command line interface"). The app and installer must match the exact version pair in `src/vault-script.ts`; a mismatch fails before Fixture setup. Without a reachable Obsidian, `pnpm e2e` skips its tests cleanly and exits 0. Set `ZOTLIT_E2E_REQUIRED=1` to require Obsidian and fail instead; `pnpm verify --release` sets this variable.

The suite talks to Obsidian's CLI socket directly, so the `obsidian` command need not be registered. Run `packages/scripts/scripts/obsidian-cli.ts version` to verify that Obsidian answers.

The e2e vault's plugin bundle comes from `@zotlit/obsidian`'s dev build (`build:dev`), never the production build: the Scope Case assertion reads `zotlit:library-scope`, a CLI command registered only under `__DEV__` and absent from production plugin bundles.

## Desktop lock

One process at a time drives the desktop Obsidian and its Paired Zotero, across all worktrees and sessions. `pnpm e2e` (each Vitest project's first global setup), `pnpm e2e:worker`, and `measure:query` take the desktop lock themselves and wait while another process holds it. A `pnpm e2e` run without a reachable Obsidian skips its tests without the lock. The waiter prints the holder's pid, command, and worktree.

- The lock is `zotlit-desktop.lock` in the git common dir (`git rev-parse --git-common-dir`), shared by every worktree of the clone. A lock whose holder process is gone is taken over. The owner record holds the process start time from `ps`, so a holder whose pid the system gave to a new process also counts as gone.
- The holder exports `ZOTLIT_DESKTOP_LOCK`; a ZotLit tool started under it reuses the lock.
- For a manual session on the desktop app (an `/obsidian-debug` walk, a series of `git commit` runs), hold the lock with `pnpm desktop-lock -- <command>`. The exit code is the command's.
- Code: `packages/scripts/lib/desktop-lock.ts`.

## Isolation

Each suite builds its own Fixture and new purged vaults under `.scratch/e2e-*`. The paired project's setup (`src/paired-setup.ts`) starts its Paired Zotero before test collection and owns its teardown at the end of the run; startup failure stops the run before tests begin. Desktop-only selections do not start Paired Zotero. The next run clears what a crashed run left. The developer's Fixture, Development Vault, and Paired Run stay open and untouched.

- Files run serially (`fileParallelism: false`): both drive the one desktop Obsidian.
- The OS focus stays with the developer and with runs in other worktrees. `keepRendering` makes a vault's windows render, and one of them act focused, behind other apps.
- `reloadWindow` (`src/window-reload.ts`) reloads a vault's whole window, so ZotLit loads in Obsidian startup order; use it for bugs a plugin reload hides.
- A Paired Zotero that fails to start or to serve its Local API fails the file.
- `src/paired-zotero.ts` holds the Local API client and the RDP levers. The [Fixture guide](../../docs/fixture.md) has the paths.

## ZotLit Query measurement

`src/query-measure.ts` proves the performance acceptance criteria of ZotLit Query in a visible Obsidian window, on the Stress Build Libraries of 10,000, 50,000, and 100,000 Items. Each tier has two parts: the queries of one Library on the Stress Build of My Library, then the `two-` queries over My Library and the group Library on the Stress Build that fills both to the Item count of the tier. Run it before a release and after a planner change; its header has the usage. The vault window must stay visible for the whole run.

- Thresholds, their evaluation, and the summary format: `src/query-record.ts`, with unit tests beside it. The queries over two Libraries (`twoLibraries` of a tier) have the execution-slice, encoding, renderer responsiveness, and cancel limits, and their totals are recorded. A tier whose run did not end that part has a failed check.
- The measurement vault uses `keepRendering`, like the End-to-end Run, so background timer throttling does not enter responsiveness samples. It remains visible and leaves OS focus with the developer.
- Each tier waits for the normal initial Item Lookup index build before timing ZotLit Query. Its separate renderer hydration and indexing work would otherwise contaminate query responsiveness and total-time samples.
- Worker runs check execution slices and encoding steps against the spec's limits, and check renderer timer gaps against the same limits. Unlimited queries write complete JSON files; the runner deletes each file after its receipt.
- The numbers come from the dev-build command `zotlit:query-measure` (`apps/obsidian/src/services/item-query/measure.ts`). A cancel through the CLI uses the production command `zotlit:query-cancel` with the `id` of the measured run.
- Output goes to `.scratch/query-measure/<time>/`: `raw.json` and `summary.md`, the comment for the release pull request.
