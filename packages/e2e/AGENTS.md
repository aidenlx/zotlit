# @zotlit/e2e

The End-to-end Run suite — the plugin running in a real desktop Obsidian window, reading the Fixture's Zotero data directory from disk. See `packages/scripts/CONTEXT.md` for the glossary (Fixture, Fixture Vault, Scope Case, End-to-end Run).

## Commands

- `pnpm e2e` (root) or `pnpm --filter @zotlit/e2e e2e` — runs the suite.
- `pnpm --filter @zotlit/e2e typecheck` — type-checks the suite.

Deliberately no `test` script: this suite drives a real Electron app and stays out of `pnpm test` / CI, which only invoke packages that declare one.

## Requirements

Needs desktop Obsidian 1.13.4+ running locally with the CLI enabled (Settings → General → Advanced → "Command line interface"). Without a reachable Obsidian, `pnpm e2e` skips its tests cleanly and exits 0 — it does not fail.

The suite talks to Obsidian's CLI socket directly, so the `obsidian` command need not be registered. Run `packages/scripts/scripts/obsidian-cli.ts version` to verify that Obsidian answers.

The e2e vault's plugin bundle comes from `@zotlit/obsidian`'s dev build (`build:dev`), never the production build: the Scope Case assertion reads `zotlit:library-scope`, a CLI command registered only under `__DEV__` and absent from production plugin bundles.

## Isolation

Each suite file builds its own Fixture and new purged vaults under `.scratch/e2e-*`; `paired-run.e2e.ts` also starts its own Paired Zotero (`src/paired-environment.ts`). The file disposes all of them at its end, and the next run clears what a crashed run left. The developer's Fixture, Development Vault, and Paired Run stay open and untouched.

- Files run serially (`fileParallelism: false`): both drive the one desktop Obsidian.
- A Paired Zotero that fails to start or to serve its Local API fails the file.
- `src/paired-zotero.ts` holds the Local API client and the RDP levers. The [Fixture guide](../../docs/fixture.md) has the paths.
