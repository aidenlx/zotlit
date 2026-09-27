# ZotLit

## Repo shape

Turborepo + pnpm monorepo for **ZotLit**, an Obsidian plugin that integrates Zotero. Workspaces are `apps/*` and `packages/*` (declared in `pnpm-workspace.yaml`).

- `apps/obsidian` — the Obsidian plugin (`@zotlit/obsidian`).
- `apps/zotero` — Zotero-side companion.
- `apps/docs` — documentation and landing sites.
- `packages/config` — consumed via `@zotlit/config` exports map.
- `packages/db` — Drizzle ORM client for Zotero database.
- `packages/item-lookup` — fuzzy item-search over `@zotlit/db`.
- `packages/protocol` — wire format (valibot schemas) for ZotLit ↔ Zotero.
- `packages/templates` — Eta-based template rendering.
- `packages/zotero-types` — generated item-field shapes from Zotero's upstream schema.
- `packages/obsidian-api` — **git submodule** (`obsidianmd/obsidian-api`). Init via `mise run init`.

## Bootstrap & toolchain

- `mise` pins to Node 26 version (see `mise.toml`). Its `idiomatic_version_file_enable_tools = ["pnpm"]` setting also activates pnpm at the version declared in root `package.json`'s `packageManager` field.
- `mise run init` initializes git submodules, including `packages/obsidian-api` and `packages/zotero-types/zotero-schema`.
- Resolve tool availability from the current workspace environment. Use `pnpm exec` for workspace binaries; use the Mise-managed toolchain defined by `mise.toml`.
- `agent-browser` (>= 0.31.1) — browser automation via CDP. Run `agent-browser skills get core` once per session for the version-matched usage guide. Session conventions and gotchas: [`docs/agents/agent-browser.md`](docs/agents/agent-browser.md).

## Commands

Run these from the repo root. `build` / `test` / `lint` go through turbo, which builds workspace dependencies first and caches outputs. Scope a task to one package with `turbo run <task> --filter=@zotlit/obsidian`; for an inner loop that needs no dependency build (single-file Vitest, `db:pull`), call the package tool directly — see each package's `AGENTS.md`.

| Command                           | What it does                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                        | `turbo run dev` (persistent, no cache).                                                                                     |
| `pnpm test`                       | `turbo run test`: Vitest in each package that defines a `test` script.                                                      |
| `pnpm lint` / `pnpm lint:fix`     | Type-aware `oxlint` over the whole tree after dependencies build. **A clean run is the typecheck.**                          |
| `pnpm format` / `pnpm format:fix` | Root-level `oxfmt` over the whole tree, run directly. A full pass takes under a second.                                      |
| `pnpm review` / `pnpm review:fix` | Obsidian guideline scan of `apps/obsidian`, release-time only (see below).                                                  |
| `pnpm quality[:fix]`              | Runs lint, then format.                                                                                                     |
| `pnpm fixture`                    | Builds the Fixture — the disposable multi-Library test environment — under `.scratch/acceptance-fixture/`. See the [Fixture guide](docs/fixture.md); run `pnpm fixture --help` for live Fixture Spec details. |
| `pnpm e2e`                        | Runs the End-to-end Run suite (`packages/e2e`) against a running desktop Obsidian; skips cleanly (not part of `pnpm test`/CI) when none is reachable. |

oxlint and oxfmt own linting and formatting; `oxlint.config.ts` / `oxfmt.config.ts` at root and per package extend `@zotlit/config/oxlint` / `@zotlit/config/oxfmt`. ESLint serves `pnpm review` alone: it runs only the `obsidianmd/*` rules against the official Obsidian developer guidelines. `release.ts` gates on it and CI re-runs it on `release/**` PRs; errors block, warnings are reported. typescript-eslint needs TypeScript 6, so root `typescript` is aliased to `@typescript/typescript6` while workspace packages keep TypeScript 7 through the catalog. Keep `eslint.config.js` and that alias ([ADR 0020](docs/adr/0020-obsidian-guideline-review-runs-on-eslint-at-release.md)).

### Testing

- **E2E-first:** A test in `packages/e2e` is the primary proof that a feature works. During development, iterate on typecheck and single test files, and walk the change through the running app (`/obsidian-debug`). When the walkthrough passes, encode it as an e2e test — the repeatable artifact of that proof.
- **Final gate:** Run the full End-to-end Run once, when the work is complete. A pass takes about 5 minutes on this machine with system sleep prevented.
- **Failure-mode-first:** When an isolated test is justified, list every failure mode before writing the code; the test list drives the implementation.
- **Earned regression tests:** A bug fix earns a regression test only for a real gap in the behavior tests. When an E2E path already reaches the failure, extend that path.

## Truth-first

Correctness before agreement. Treat every user claim as unverified until checked. Reserve "you're right" for verified claims; lead with the correction, not fake agreement. Hold a verified conclusion when pushed back — revise only on new evidence, and say what changed your mind.

## First principles

Start with the user's goal and necessary constraints. Separate these from assumptions in the current design, test assumptions that affect the solution, and derive the simplest approach that meets the requirements. Evaluate existing patterns by the problem they solve.

## Target users

ZotLit's primary users are non-technical academics: assume research expertise and little programming knowledge. Design around their research tasks, with familiar academic terms, useful defaults, and complete UI workflows for routine work. Explain choices in terms of research outcomes; introduce technical details when they help the user make a decision.

## Affirmative specs

Describe the target state — what exists and what to do. Negation activates the concept it tries to suppress, so state the replacement, not the rejection. If a contrast is needed, the positive target comes first ("Use X" / "Prefer X over Y"); keep "why not X" rationale out of the spec body.

## Report language

Write reports to the user in ASD-STE100 Simplified Technical English.

## Surgical changes

Every changed line traces to the user's request. Leave adjacent code, comments, and formatting as found. Remove only the orphans your own changes created; mention pre-existing dead code, don't delete it.

## i18n

User-facing strings are sourced from `messages/{locale}.json` and consumed through the generated Language Pack facade; ZotLit Companion copy lives in the same catalogs under the `zotero` object and compiles to Fluent at Companion build time. Run `/inlang-i18n` for message-format and runtime mechanics. Wording follows Obsidian's developer-guideline style (sentence case, terminology, phrasing) — run `/i18n-ui-text` before authoring or editing a string.

User- and agent-facing copy has three sources: MDX under `apps/docs/content/`, i18n messages under `messages/` (Obsidian, Companion, and docs alike), and the Template Workbench CLI guide at `apps/obsidian/src/services/template-workbench/guide.ts`.

## Conventions worth knowing

- Dependency versions shared by multiple packages go in the **catalog** in `pnpm-workspace.yaml`; package-local dependencies stay in that package's `package.json`. Catalog users reference shared entries as `"oxlint": "catalog:"`.
- pnpm settings (`allowBuilds`, `minimumReleaseAge`, `catalog`) belong in `pnpm-workspace.yaml`, not under a `"pnpm"` key in `package.json`.
- `minimumReleaseAge` in `pnpm-workspace.yaml` is intentional, a supply-chain hardening measure.
- `__DEV__` is replaced at build time (`true` in dev mode, `false` in production).
- Use `pnpm exec` instead of `npx`.
- Brand identity — logo geometry, palette, and wordmark (Archivo SemiBold) — is specified in [`docs/brand.md`](docs/brand.md); canonical SVGs live in `assets/logo/`. Consume those assets and follow that spec rather than redrawing the mark.

## Working files

Choose the destination by purpose:

- **Session material** — `.scratch/`, under the workspace root or the package you are working in: probe scripts, experiment output, research notes at `.scratch/notes/`, draft specs and tickets, intermediate output. Git-ignored and inside the tree, so a script there resolves `node_modules` like any other file, and the artifacts stay visible and cleanable — `/tmp` and a session scratchpad give neither. Remove them when the work is done.
- **Planned work** — the issue tracker: agreed specs and tickets, with progress, findings, and handoffs as comments on the owning ticket. See `docs/agents/issue-tracker.md`.
- **Maintained reference** — `docs/`: architecture, runbooks, ADRs, research reports, process config. Create a new file there only with explicit user permission, skill output included; keep the draft in `.scratch/` until then.

## Agent skills

### Issue tracker

Issues, specs, and tickets are tracked in GitHub Issues; external pull requests are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout — `GLOSSARY-MAP.md` at the repo root points to per-workspace `GLOSSARY.md` files under `apps/*` and `packages/*`. See `docs/agents/domain.md`. Context names there (e.g. "Zotero Data Model") are heading labels for that map; code, comments, and user-facing copy keep the casing their own convention calls for (see i18n above for UI text).
