# ZotLit

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
| `pnpm test`                       | `turbo run test` across packages that define a `test` script (typecheck + Vitest in each).                                  |
| `pnpm lint` / `pnpm lint:fix`     | Root-level `oxlint` over the whole tree. **the lint step also performs typechecking** via tsgo.                             |
| `pnpm format` / `pnpm format:fix` | Root-level `oxfmt`.                                                                                                         |
| `pnpm quality[:fix]`              | Lint + format together via turbo.                                                                                           |

Linter/formatter are **oxlint + oxfmt**, not ESLint/Prettier. Configs live at `oxlint.config.ts` / `oxfmt.config.ts` at root and per-package, extending `@zotlit/config/oxlint` and `@zotlit/config/oxfmt`.

Per-package tasks: use pnpm filters, e.g.:

- `pnpm --filter @zotlit/obsidian build` (Vite build + typecheck)
- `pnpm --filter @zotlit/obsidian dev` (Vite watch, dev mode)
- `pnpm --filter @zotlit/obsidian test` (typecheck test tsconfig + `vitest run`)
- `pnpm --filter @zotlit/obsidian exec vitest run path/to/file.test.ts` (single file; skips typecheck)
- `pnpm --filter @zotlit/db build` / `dev` (tsdown)
- `pnpm --filter @zotlit/db db:pull` (drizzle-kit pull)

## Code patterns

### Simplicity

- Prefer KISS implementations: keep code local and direct unless abstraction has a concrete payoff.
- Bias against over-engineering: avoid speculative layers, one-caller helper files, generic plumbing, and exported DTOs/types that do not clarify a real boundary.
- When reviewing designs or code, call out unnecessary abstraction and suggest the smallest maintainable alternative.

### Comments

- Prefer code over comments: use clear logic and naming to express intent, so the implementation reads as documentation.
- Use JSDoc on functions, methods, and key variables when additional detail (contracts, units, invariants, non-obvious rationale) actually helps a reader.
- When documenting a function, prefer structured JSDoc tags (`@param`, `@returns`, `@throws`) over prose descriptions.
- Drop comments that only restate what the name, type signature, or implementation already conveys (e.g. `/** Build a fresh shallow clone of X */` above a one-line spread, or `/** Throw if X */` above a method named `requireX`). Keep only the non-obvious parts: invariants, edge cases, design rationale, and "why" over "what".
- Trim mixed JSDoc to the non-obvious parts rather than dropping the whole block. If the first sentence restates the name and the rest explains an invariant, delete the first sentence.

### Logging

Use [LogTape](https://logtape.org) for all runtime logging — never `console.log` / `console.info` / `console.debug` / `console.warn` / `console.error` in feature code.

Categories form a hierarchy rooted at the workspace name:

- App code in `apps/obsidian` → `["zotlit", "obsidian", ...]`. Import `getLogger` from `@/lib/log` (a thin wrapper around `["zotlit", "obsidian"]`).
- Library packages (`@zotlit/shared`, `@zotlit/db`, etc.) → `["zotlit", "<package>", ...]`. Import `getLogger` directly from `@logtape/logtape`: `getLogger(["zotlit", "shared", "feature"])`. Do **not** depend on the obsidian app's wrapper.

Library packages must **never** call `configure()` — that is the application's job. Libraries only `getLogger()`. The obsidian app owns `configure()` via `LoggingService`.

Prefer **structured** logging over interpolated strings:

```ts
// Good — fields are searchable
logger.info("Indexed library", { count, durationMs });
logger.error("Failed to sync attachment", { itemKey, error });

// Avoid — opaque blob
logger.info(`Indexed ${count} items in ${durationMs}ms`);
```

For expensive context, pass a lazy callback so the work is skipped when the level is filtered:

```ts
logger.debug("Stats computed", () => ({
  result: expensive(),
  elapsed: perf.now() - t0,
}));
```

### i18n

User-facing strings go through Paraglide JS — compile-time, tree-shakable message functions sourced from `messages/{locale}.json` at the repo root.

Use `snake_case` for message keys (e.g. `settings_log_heading`). Keys must be valid JS identifiers — no hyphens, no dots. Group by UI section with a stable prefix that matches the heading (`settings_log_*`, `settings_template_general_*`, etc.); notices use the `notice_*` prefix.

Run `/paraglide-i18n` skill for related task

### Separate pure logic from stateful orchestration

Default to one cohesive module. Extract pure helpers only when the split removes real complexity from stateful orchestration, makes meaningful edge cases easier to test, or matches an existing local pattern. Pure helpers take all inputs as args, return plain results, hold no state, perform no I/O, and never import the orchestrator. Dependencies flow one direction (leaves → root); no cycles, no peer imports between same-level helpers.

Use the smallest useful split:

- Prefer private functions or private class methods before creating sibling files.
- Do not create a new file just to make an entry module look like a thin orchestrator.
- Do not introduce exported DTOs/types that are only plumbing for one caller unless they clarify a real boundary.
- If you split, keep the public import path stable by re-exporting the public surface from the entry module (aka index.ts).

Split only when at least one of the following is true and the extraction has a clear payoff:

- The file is past ~250 lines and still growing because unrelated concerns are accumulating.
- The same pure logic appears in multiple methods or modules.
- A reader has to hold both orchestration and detailed branching in their head simultaneously to follow the code.
- The pure logic has enough edge cases that unit-testing it through the orchestrator requires awkward mocking or setup.

If none of those apply, a single file with private methods is the simpler answer. Do not pre-split for hypothetical future complexity.

## Conventions worth knowing

- Shared dependency versions go in the **catalog** in `pnpm-workspace.yaml`. Packages reference them as `"oxlint": "catalog:"`.
- pnpm settings (`allowBuilds`, `minimumReleaseAge`, `catalog`) belong in `pnpm-workspace.yaml`, not under a `"pnpm"` key in `package.json`.
- `minimumReleaseAge: 1440` (24h delay) is intentional, a supply-chain hardening measure.
- `__DEV__` is replaced at build time (`true` in dev mode, `false` in production).
- Use ripgrep (`rg`) in shell calls — a global hook denies `grep`/`egrep`/`fgrep`.
- - **Package manager is pnpm.** Use `pnpm exec` instead of `npx`.
- Use ECMAScript private fields and methods (`#field`, `#method`) for internal state. Avoid TypeScript `private` for service internals.
