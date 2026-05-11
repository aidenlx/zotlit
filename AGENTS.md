# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo shape

Turborepo + pnpm monorepo for **ZotLit**, an Obsidian plugin that integrates Zotero. Workspaces are `apps/*` and `packages/*` (declared in `pnpm-workspace.yaml`).

- `apps/obsidian` — the plugin itself (`@zotlit/obsidian`).
- `apps/zotero` — Zotero-side companion.
- `apps/website` — the ZotLit website.
- `packages/config` — shared `tsconfig.*`, `oxlint.base.ts`, `oxfmt.base.ts`. Consumed via the `@zotlit/config` exports map.
- `packages/db` — Drizzle ORM client for Zotero database query.
- `packages/shared` — shared utilities.
- `packages/scripts` — helpful scripts
- `packages/obsidian-api` — **git submodule** (`obsidianmd/obsidian-api`) providing `obsidian.d.ts`. Must be initialized via `mise run init` (or `git submodule update --init --recursive`) before typecheck succeeds.

## Bootstrap & toolchain

- `mise` pins to Node 26 version (see `mise.toml`). It also runs `corepack enable` post-install to activate pnpm at the version declared in root `package.json`.

## Commands

Root scripts (run from repo root):

| Command                           | What it does                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`                      | `turbo run build` across the graph.                                                                                         |
| `pnpm dev`                        | `turbo run dev` (persistent, no cache).                                                                                     |
| `pnpm typecheck`                  | `turbo run typecheck`. Each package runs `tsgo` (the `@typescript/native-preview` / TypeScript 7 compiler) — **not** `tsc`. |
| `pnpm lint` / `pnpm lint:fix`     | Root-level `oxlint` over the whole tree. **the lint step also performs typechecking** via tsgo.                             |
| `pnpm format` / `pnpm format:fix` | Root-level `oxfmt`.                                                                                                         |
| `pnpm quality[:fix]`              | Lint + format together via turbo.                                                                                           |

Linter/formatter are **oxlint + oxfmt**, not ESLint/Prettier. Configs live at `oxlint.config.ts` / `oxfmt.config.ts` at root and per-package, extending `@zotlit/config/oxlint` and `@zotlit/config/oxfmt`.

Per-package tasks: use pnpm filters, e.g.:

- `pnpm --filter @zotlit/obsidian build` (Vite build + typecheck)
- `pnpm --filter @zotlit/obsidian dev` (Vite watch, dev mode)
- `pnpm --filter @zotlit/obsidian test` (Vitest, `vitest run`)
- `pnpm --filter @zotlit/db build` / `dev` (tsdown)
- `pnpm --filter @zotlit/db db:pull` (drizzle-kit pull)

## Code patterns

### Separate pure logic from stateful orchestration

When a module is non-trivial, push as much logic as possible into **pure functions** in sibling files, and let the stateful entry module stay a thin orchestrator over them. Pure helpers take all inputs as args, return plain results, hold no state, perform no I/O, and never import the orchestrator. Dependencies flow one direction (leaves → root); no cycles, no peer imports between same-level helpers.

Typical moves:

- Helpers stay testable without instantiating the orchestrator or mocking I/O. Integration tests through the orchestrator cover wiring; unit tests at each helper cover edge cases.
- If you split, the entry module re-exports the public surface so consumers still have a single import path.

**Skip this when KISS says so.** Most modules don't need it. Apply only when at least one of the following is true:

- The file is past ~200 lines and growing.
- The same logic appears in multiple methods.
- A reader has to hold both orchestration and detail in their head simultaneously to follow the code.
- The pure logic has enough edge cases that unit-testing it through the orchestrator is awkward.

If none of those apply, a single file with private methods is the simpler answer — don't pre-split for hypothetical future complexity.

## Conventions worth knowing

- Shared dependency versions go in the **catalog** in `pnpm-workspace.yaml`. Packages reference them as `"oxlint": "catalog:"`.
- pnpm settings (`allowBuilds`, `minimumReleaseAge`, `catalog`) belong in `pnpm-workspace.yaml`, not under a `"pnpm"` key in `package.json`.
- `minimumReleaseAge: 1440` (24h delay) is intentional, a supply-chain hardening measure.
- `__DEV__` is replaced at build time (`true` in dev mode, `false` in production).
- Use ripgrep (`rg`) in shell calls — a global hook denies `grep`/`egrep`/`fgrep`.
- - **Package manager is pnpm.** Use `pnpm exec` instead of `npx`.
- Use ECMAScript private fields and methods (`#field`, `#method`) for internal state. Avoid TypeScript `private` for service internals.
