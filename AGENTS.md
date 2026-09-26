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

**Prefer turbo for `build` / `test` / `lint`.** Going through turbo resolves the workspace dependency graph and caches outputs, so repeat runs are near-instant. Those root scripts delegate to `turbo run` — run them from the repo root:

| Command                           | What it does                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                        | `turbo run dev` (persistent, no cache).                                                                                     |
| `pnpm test`                       | `turbo run test` across packages that define a `test` script (typecheck + Vitest in each).                                  |
| `pnpm lint` / `pnpm lint:fix`     | Root-level `oxlint` over the whole tree. Builds deps via turbo caching, then typechecks + lints in one pass. **A clean run verifies types — no separate `tsgo`/`turbo run typecheck` pass.** |
| `pnpm format` / `pnpm format:fix` | Root-level `oxfmt` over the whole tree, run directly. A full pass takes under a second.                                      |
| `pnpm review` / `pnpm review:fix`  | Obsidian guideline scan of `apps/obsidian` (ESLint). Release-time only — `release.ts` gates on it and CI re-runs it on `release/**` PRs. Blocks on errors; warnings are reported. |
| `pnpm quality[:fix]`              | Runs lint, then format.                                                                                                     |
| `pnpm fixture`                    | Builds the Fixture — the disposable multi-Library test environment — under `.scratch/acceptance-fixture/`. See the [Fixture guide](docs/fixture.md); run `pnpm fixture --help` for live Fixture Spec details. |
| `pnpm e2e`                        | Runs the End-to-end Run suite (`packages/e2e`) against a running desktop Obsidian; skips cleanly (not part of `pnpm test`/CI) when none is reachable. |

**The End-to-end Run is the final gate, run once when the work is complete.** During development, iterate on typecheck and single test files, and prove a change end to end by walking it through the running app (`/obsidian-debug`); once that walkthrough passes, encode it as a test in `packages/e2e`, the repeatable artifact of that proof. A full pass takes over an hour.

Linter/formatter are **oxlint + oxfmt**, not ESLint/Prettier. Configs live at `oxlint.config.ts` / `oxfmt.config.ts` at root and per-package, extending `@zotlit/config/oxlint` and `@zotlit/config/oxfmt`.

ESLint is present at the root for **one** purpose: `pnpm review` checks `apps/obsidian` against the official Obsidian developer guidelines via `eslint-plugin-obsidianmd`, before a release is cut. Only the `obsidianmd/*` rules are enabled — oxlint owns everything else. Root `typescript` is aliased to `@typescript/typescript6` because typescript-eslint cannot run on TypeScript 7; workspace packages keep TypeScript 7 via the catalog. Leave `eslint.config.js` and that alias in place. See [ADR 0020](docs/adr/0020-obsidian-guideline-review-runs-on-eslint-at-release.md).

Scope a task to one package with a turbo filter so its deps still build first: `turbo run <task> --filter=@zotlit/obsidian`. For tight inner-loop iteration that doesn't need the dep graph (single-file Vitest, `db:pull`, etc.), call the package tool directly — see each package's `AGENTS.md`.

## Truth-first

Correctness before agreement. Treat every user claim as unverified until checked. Reserve "you're right" for verified claims; lead with the correction, not fake agreement. Hold a verified conclusion when pushed back — revise only on new evidence, and say what changed your mind.

## Affirmative specs

Describe the target state — what exists and what to do. Negation activates the concept it tries to suppress, so state the replacement, not the rejection. If a contrast is needed, the positive target comes first ("Use X" / "Prefer X over Y"); keep "why not X" rationale out of the spec body.

## Report language

Write reports to the user in ASD-STE100 Simplified Technical English.

## Surgical changes

Every changed line traces to the user's request. Leave adjacent code, comments, and formatting as found. Remove only orphans YOUR changes created; mention pre-existing dead code, don't delete it.

## Code standard

Authoring conventions live in [`policies/`](policies/), one topic per file:

- [simplicity](policies/simplicity.md) — KISS, minimum viable code
- [deep modules](policies/pure-logic.md) — default to one cohesive module; split only with concrete payoff
- [comments](policies/comments.md) — JSDoc conventions, module-level comments
- [function-parameters](policies/function-parameters.md) — max 3 positional, options object for the rest
- [testing strategy](policies/testing-strategy.md) — E2E-first; failure-mode-first for isolation tests; regression tests earn their place
- [tautological tests](policies/tautological-tests.md) — independent oracles, change detectors, consumer boundaries, and bulk assertions
- [test timing](policies/test-timing.md) — completion signals, clocks, polling, and external events
- [test isolation](policies/test-isolation.md) — fixture state, resource allocation, lifetime, setup cost, and order dependence
- [ui-testing](policies/ui-testing.md) — test decisions and wiring, not drawing; visual correctness is proved in the running app
- [resource-disposal](policies/resource-disposal.md) — scope-bound `using`, safe-constructor, destructuring gotcha
- [regex](policies/regex.md) — arkregex for typed captures; `/arkregex` skill
- [event-naming](policies/event-naming.md) — nanoevents event names are dash-case, not camelCase
- [package and workspace roots](policies/package-roots.md) — package-root paths and pnpm workspace discovery
- [logging](policies/logging.md) — LogTape, structured fields
- [observability](policies/observability.md) — lean `info`; permanent `debug` / `trace` at decision points
- [temporal-dates](policies/temporal-dates.md) — Temporal API, not Date/date-fns/dayjs
- [vocabulary](policies/vocabulary.md) — canonical terms for Zotero keys, citation keys, and `citekey`
- [CLI + skill pair](policies/cli-skill-pair.md) — tooling facts in the CLI; process, policy, and tone in the skill
- [CLI help](policies/cli-help.md) — help and reference generated from handler code; yargs for Node.js, guide commands for Obsidian
- [grouping](policies/grouping.md) — `Map.groupBy` / `Object.groupBy` for keyed grouping
- [host-state](policies/host-state.md) — read host state on demand through a seam helper; a set filled by event replay is a mirror

### i18n

User-facing strings are sourced from `messages/{locale}.json` and consumed through the generated Language Pack facade; ZotLit Companion copy lives in the same catalogs under the `zotero` object and compiles to Fluent at Companion build time. Run `/inlang-i18n` for message-format and runtime mechanics. Wording follows Obsidian's developer-guideline style (sentence case, terminology, phrasing) — run `/i18n-ui-text` before authoring or editing a string.

User- and agent-facing copy has three sources: MDX under `apps/docs/content/`, i18n messages under `messages/` (Obsidian, Companion, and docs alike), and the Template Workbench CLI guide at `apps/obsidian/src/services/template-workbench/guide.ts`. Use the canonical terms in [policies/vocabulary.md](policies/vocabulary.md).

## Conventions worth knowing

- Dependency versions shared by multiple packages go in the **catalog** in `pnpm-workspace.yaml`; package-local dependencies stay in that package's `package.json`. Catalog users reference shared entries as `"oxlint": "catalog:"`.
- pnpm settings (`allowBuilds`, `minimumReleaseAge`, `catalog`) belong in `pnpm-workspace.yaml`, not under a `"pnpm"` key in `package.json`.
- `minimumReleaseAge` in `pnpm-workspace.yaml` is intentional, a supply-chain hardening measure.
- `__DEV__` is replaced at build time (`true` in dev mode, `false` in production).
- Use `pnpm exec` instead of `npx`.
- ECMAScript private fields and methods (`#field`, `#method`) for internal state. Avoid TypeScript `private` for service internals.
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
