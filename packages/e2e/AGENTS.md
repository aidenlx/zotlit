# @zotlit/e2e

The End-to-end Run suite — the plugin running in a real desktop Obsidian window, reading the Fixture's Zotero data directory from disk. See `packages/scripts/CONTEXT.md` for the glossary (Fixture, Fixture Vault, Scope Case, End-to-end Run).

## Commands

- `pnpm e2e` (root) or `pnpm --filter @zotlit/e2e e2e` — runs the suite.
- `pnpm --filter @zotlit/e2e typecheck` — type-checks the suite.

Deliberately no `test` script: this suite drives a real Electron app and stays out of `pnpm test` / CI, which only invoke packages that declare one.

## Requirements

Needs desktop Obsidian 1.12.7+ running locally with the CLI enabled (Settings → General → Advanced → "Command line interface"). Without a reachable Obsidian, `pnpm e2e` skips its tests cleanly and exits 0 — it does not fail.

The e2e vault's plugin bundle comes from `@zotlit/obsidian`'s dev build (`build:dev`), never the production build: the Scope Case assertion reads `zotlit:library-scope`, a CLI command registered only under `__DEV__` and absent from production plugin bundles.

## Scope

One suite, `src/end-to-end.e2e.ts`: builds and registers a dedicated e2e vault under `tmp/e2e-fixture-vault`, drives it over the Obsidian CLI, and tears the vault down afterward. Documentation for the wider Fixture effort is tracked separately (#804).
