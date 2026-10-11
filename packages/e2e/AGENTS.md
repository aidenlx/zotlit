# @zotlit/e2e

The End-to-end Run suite — the plugin running in a real desktop Obsidian window, reading the Fixture's Zotero data directory from disk. See `packages/scripts/GLOSSARY.md` for the glossary (Fixture, Fixture Vault, Scope Case, End-to-end Run).

## Commands

- `pnpm e2e` (root) or `pnpm --filter @zotlit/e2e e2e` — runs the suite.
- `pnpm --filter @zotlit/e2e typecheck` — type-checks the suite.
- Worker responsiveness: `pnpm e2e:worker` requires desktop Obsidian and passes only when the unchanged refresh, changed-Item rebuild, and rejected-snapshot cases all execute. The commit hook runs it for the paths listed in `lefthook.yml`. Its worker timer detects stalls that sequential search p99 can hide.

Deliberately no `test` script: this suite drives a real Electron app and stays out of `pnpm test` / CI, which only invoke packages that declare one.

The default reporter prints suite progress and the final counts. Read `.scratch/e2e-results/results.json` for individual results and `.scratch/e2e-results/console.log` for console evidence. A Paired Run setup failure writes `paired-startup.log` in that directory with the launch error chain. These files describe the latest run; copy evidence you need to retain before another run.

## Requirements

Needs desktop Obsidian running locally with the CLI enabled (Settings → General → Advanced → "Command line interface"). The app and installer must match the exact version pair in `src/vault-script.ts`; a mismatch fails before Fixture setup. Without a reachable Obsidian, `pnpm e2e` skips its tests cleanly and exits 0.

The suite talks to Obsidian's CLI socket directly, so the `obsidian` command need not be registered. Run `packages/scripts/scripts/obsidian-cli.ts version` to verify that Obsidian answers.

The e2e vault's plugin bundle comes from `@zotlit/obsidian`'s dev build (`build:dev`), never the production build: the Scope Case assertion reads `zotlit:library-scope`, a CLI command registered only under `__DEV__` and absent from production plugin bundles.

## Isolation

Each suite builds its own Fixture and new purged vaults under `.scratch/e2e-*`. The paired project's setup (`src/paired-setup.ts`) starts its Paired Zotero before test collection and owns its teardown at the end of the run; startup failure stops the run before tests begin. Desktop-only selections do not start Paired Zotero. The next run clears what a crashed run left. The developer's Fixture, Development Vault, and Paired Run stay open and untouched.

- Files run serially (`fileParallelism: false`): both drive the one desktop Obsidian.
- The OS focus stays with the developer and with runs in other worktrees. `keepRendering` makes a vault's windows render, and one of them act focused, behind other apps.
- A Paired Zotero that fails to start or to serve its Local API fails the file.
- `src/paired-zotero.ts` holds the Local API client and the RDP levers. The [Fixture guide](../../docs/fixture.md) has the paths.
