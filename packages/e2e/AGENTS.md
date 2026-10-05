# @zotlit/e2e

The End-to-end Run suite — the plugin running in a real desktop Obsidian window, reading the Fixture's Zotero data directory from disk. See `packages/scripts/GLOSSARY.md` for the glossary (Fixture, Fixture Vault, Scope Case, End-to-end Run).

## Commands

- `pnpm e2e` (root) or `pnpm --filter @zotlit/e2e e2e` — runs the suite.
- `pnpm --filter @zotlit/e2e typecheck` — type-checks the suite.

- `pnpm --filter @zotlit/e2e measure:item-query` — the release-time measurement of Item Query (see below).
- `pnpm --filter @zotlit/e2e test` — unit tests of the measurement record (`src/**/*.test.ts`, `vitest.unit.config.ts`). They touch no Obsidian.

The End-to-end Run and the measurement drive a real Electron app and stay out of `pnpm test` / CI: the `test` script runs the unit tests alone.

## Requirements

Needs desktop Obsidian 1.13.4+ running locally with the CLI enabled (Settings → General → Advanced → "Command line interface"). Without a reachable Obsidian, `pnpm e2e` skips its tests cleanly and exits 0 — it does not fail.

The suite talks to Obsidian's CLI socket directly, so the `obsidian` command need not be registered. Run `packages/scripts/scripts/obsidian-cli.ts version` to verify that Obsidian answers.

The e2e vault's plugin bundle comes from `@zotlit/obsidian`'s dev build (`build:dev`), never the production build: the Scope Case assertion reads `zotlit:library-scope`, a CLI command registered only under `__DEV__` and absent from production plugin bundles.

## Isolation

Each suite file builds its own Fixture and new purged vaults under `.scratch/e2e-*`; `paired-run.e2e.ts` also starts its own Paired Zotero (`src/paired-environment.ts`). The file disposes all of them at its end, and the next run clears what a crashed run left. The developer's Fixture, Development Vault, and Paired Run stay open and untouched.

- Files run serially (`fileParallelism: false`): both drive the one desktop Obsidian.
- The OS focus stays with the developer and with runs in other worktrees. `keepRendering` makes a vault's windows render, and one of them act focused, behind other apps.
- A Paired Zotero that fails to start or to serve its Local API fails the file.
- `src/paired-zotero.ts` holds the Local API client and the RDP levers. The [Fixture guide](../../docs/fixture.md) has the paths.

## Item Query measurement

`src/item-query-measure.ts` proves the performance acceptance criteria of Item Query in a visible Obsidian window, on the Stress Build Libraries of 10,000, 50,000, and 100,000 Items. Each tier has two parts: the queries of one Library on the Stress Build of My Library, then the `two-` queries over My Library and the group Library on the Stress Build that fills both to the Item count of the tier. Run it before a release and after a planner change; its header has the usage. The vault window must stay visible for the whole run.

- Thresholds, their evaluation, and the summary format: `src/item-query-record.ts`, with unit tests beside it. The queries over two Libraries (`twoLibraries` of a tier) have the slice limits and the cancel limit, and their totals are recorded. A tier whose run did not end that part has a failed check.
- The numbers come from the dev-build commands `zotlit:item-query-measure` and `zotlit:item-query-measure-cancel` (`apps/obsidian/src/services/item-query/measure.ts`).
- Output goes to `.scratch/item-query-measure/<time>/`: `raw.json` and `summary.md`, the comment for the release pull request.
