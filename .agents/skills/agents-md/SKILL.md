---
name: agents-md
description: |
  Writing and maintaining AGENTS.md files in this monorepo. Use when creating a new package/app
  AGENTS.md, editing an existing one, auditing AGENTS.md content for duplication or bloat, or
  when the user mentions AGENTS.md, CLAUDE.md, agent instructions, or context files. Also use
  when adding a new workspace and it needs agent documentation, or when reviewing whether
  AGENTS.md content belongs at root vs per-package level.
---

# Writing AGENTS.md

AGENTS.md files are context files for AI coding agents. In this monorepo, the root AGENTS.md
covers repo-wide concerns; per-package files cover only what differs from root or is specific
to that package.

Research (ETH Zurich, arXiv 2602.11988) shows that auto-generated and redundant context files
**reduce** agent success rates while increasing cost 20%+. The payoff comes from short,
hand-written files containing only non-inferable information. Every line you add dilutes every
other line — there is no free lunch.

## Hierarchy

```
AGENTS.md              ← repo-wide: commands, code patterns, conventions
apps/obsidian/AGENTS.md  ← package-specific: logging import, CSS prefix, testing
packages/db/AGENTS.md    ← package-specific: query patterns, schema conventions
```

Each per-package `CLAUDE.md` contains only `@AGENTS.md` — a one-line import. Keep all
instructions in `AGENTS.md` so they work across tools.

## Core principles

### 1. Earn every line

Include information the agent can't cheaply discover from the code. Two categories qualify:

- **Non-inferable** — decisions, constraints, or "use X not Y" rules that aren't expressed in
  code, types, or linter config. No amount of exploring reveals them.
- **Expensive to infer** — conclusions that require reading across multiple files, configs, or
  implicit conventions. A pointer saves the agent that cross-referencing work.

Include:
- Exact commands with flags (`pnpm exec vitest run path/to/file.test.ts`)
- "Use X, not Y" decisions that aren't enforced by tooling (`LogTape, not console.*`)
- Domain vocabulary and conventions that differ from language defaults
- Pointers to canonical files the agent should read before editing an area
- Short summaries of cross-cutting patterns that span several files (with pointers to the
  sources, so the agent can verify and go deeper)

Exclude:
- Directory trees (the agent runs `ls` / `find`)
- Type signatures or API shapes (the agent reads the source)
- Style rules the linter enforces (oxlint handles it)
- Language defaults the model already knows (TypeScript syntax, etc.)

### 2. Index over describe

Point to implementations rather than duplicating them. This keeps the AGENTS.md accurate as
code evolves and teaches the agent where to look.

Good — pointer:
```markdown
## Service Architecture
Read `src/services/service-base.ts` for the `Service` base class and `ServiceContainer`.
Read `src/services/build.ts` for wiring. Treat both as authoritative.
```

Bad — description that will drift:
```markdown
## Service Architecture
Services extend `Service` which has a `ready` promise and `[Symbol.asyncDispose]`.
The constructor calls `super()`, stores deps, and assigns `this.ready = this.#load()`.
Resources go in an `AsyncDisposableStack` committed via `this.commit(stack.move())`...
```

The exception: when the pattern is invisible from the code alone (e.g., "never call
`configure()` in a library package" — the agent can't infer this from reading a single
library). State the rule, link the why.

### 3. No duplication across levels

Root AGENTS.md owns shared concerns. Per-package files **defer** to root with a one-line
cross-reference instead of restating.

Good:
```markdown
## Commands
Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands).
Package-specific: `pnpm --filter @zotlit/db db:pull` — drizzle-kit pull.
```

Bad:
```markdown
## Commands
| Command | What it does |
| `pnpm build` | `turbo run build` across the graph |
...
```

Shared code patterns (simplicity, comments, disposal, logging philosophy) live in root only.
Per-package files cover only the local import path or the package-specific deviation.

### 4. Keep it short

- Root: under ~200 lines (this repo's root is the CLAUDE.md, which includes behavioral rules
  that apply to all work — these are legitimate non-inferable content).
- Per-package: under ~100 lines. Most packages need 20–60 lines.
- If approaching the limit, move detail to a skill (`.claude/skills/`) with progressive
  disclosure, or to a `docs/` file the AGENTS.md points at.

### 5. Lead with commands

First section after the package title should be exact, executable commands. Agents reference
these constantly. Wrap in backticks so they can be copied verbatim.

## Per-package AGENTS.md template

```markdown
# @zotlit/<package-name>

[One sentence: what this package does, its key constraint or boundary.]

## Commands

Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands).
Package-specific tools:

- `pnpm --filter @zotlit/<name> <script>` — what it does.

## [Domain-specific section]

[Rules or pointers that are specific to this package and non-inferable.]

## Logging

Import `getLogger` from `<import-path>` with category `["zotlit", "<pkg>", ...]`.

```ts
import { getLogger } from "<path>";
const logger = getLogger(["zotlit", "<pkg>", "<module>"]);
```

[For apps: note who owns `configure()`. For libraries: "Never call `configure()` here."]
```

## What belongs where — decision guide

| Content | Where |
|---|---|
| Build/test/lint commands (repo-wide) | Root |
| Package-specific scripts | Per-package |
| Code patterns (simplicity, comments, disposal) | Root |
| Package-specific API conventions | Per-package |
| Logging philosophy + structured logging examples | Root |
| Logging import path + category for this package | Per-package |
| i18n approach (Paraglide) | Root (one line + skill pointer) |
| i18n import path and compilation for obsidian | Per-package |
| Toolchain (mise, pnpm, oxlint) | Root |
| Package-specific linter overrides | Per-package |

## Maintenance rules

- Update AGENTS.md **in the same PR** that changes the convention it documents.
- Add a rule only the **second time** an agent makes the same mistake — one-off corrections
  belong in conversation, not permanent instructions.
- Periodically audit: if a linter rule, hook, or CI check now enforces something, delete it
  from AGENTS.md.
- When a skill covers a topic in depth (e.g., `/obsidian-services`, `/valibot`), the AGENTS.md
  entry should be a one-liner pointing at the skill, not a condensed duplicate.
