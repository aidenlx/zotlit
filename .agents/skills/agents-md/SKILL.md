---
name: agents-md
description: |
  Writing and maintaining AGENTS.md files in this monorepo. Use when creating or editing a
  package/app AGENTS.md, auditing one for no-ops or duplication, or deciding whether content
  belongs at root vs per-package level.
---

# Writing AGENTS.md

Root AGENTS.md covers repo-wide concerns; per-package files cover only what differs or is
specific to that package. Every line dilutes every other line — the payoff comes from short
files containing only non-inferable information.

The levers below — **leading words**, the **no-op test**, **progressive disclosure**, **single
source of truth**, **duplication** — are the same ones that govern skills; the
`writing-great-skills` skill treats them in full. Consult it when applying these here, and when
a topic outgrows AGENTS.md and should become a skill.

## Hierarchy

```
AGENTS.md                  ← resource map: commands, conventions-index, pointers
policies/*.md              ← repo-wide code-authoring conventions, one file per topic
docs/agents/*.md           ← process/skill config (issue tracker, triage labels, domain layout)
.claude/skills/            ← deep how-to for one area, fired by name or model-invocation
apps/*/AGENTS.md           ← package-specific resource map
apps/*/policies/*.md       ← package-specific conventions
packages/*/AGENTS.md       ← package-specific resource map
packages/*/policies/*.md   ← package-specific conventions
```

`policies/` at root holds repo-wide code-authoring conventions as terse, no-op-tested rule
files — one topic per file. Per-package `policies/` directories follow the same shape for
conventions specific to that package. Cross-cutting behavioral rules (truth-first reasoning,
disagreement style) stay inline at root — they must be in the always-loaded context.
`docs/agents/` holds process config consumed by workflow skills. AGENTS.md stays a thin
**resource map** pointing at both.

Each per-package `CLAUDE.md` contains only `@AGENTS.md` — a one-line import. Keep all
instructions in `AGENTS.md` so they work across tools.

## Core principles

### 1. Earn every line

Two categories of content qualify:

- **Non-inferable** — decisions, constraints, or "use X not Y" rules that aren't expressed in
  code, types, or linter config.
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
- Hardcoded config values that live in a config file (version numbers, numeric settings,
  thresholds). Point to the config file instead — the value will drift, the file won't.

The **no-op test** settles every borderline line: delete it and ask whether agent behavior
changes. If output is unchanged, the line was a no-op — the model already obeyed it by default
(`be thorough`, `write clean code`, `handle errors carefully`). Cut it. Run this sentence by
sentence when auditing an existing file; most prose that fails should go, not be rewritten.

### 2. Index over describe

Treat AGENTS.md as a **resource map** — point to implementations rather than duplicating them.

Good — pointer:
```markdown
Service Architecture
Read `src/services/service-base.ts` for the `Service` base class and `ServiceContainer`.
Read `src/services/build.ts` for wiring. Treat both as authoritative.
```

Bad — description that will drift:
```markdown
Service Architecture
Services extend `Service` which has a `ready` promise and `[Symbol.asyncDispose]`.
The constructor calls `super()`, stores deps, and assigns `this.ready = this.#load()`.
Resources go in an `AsyncDisposableStack` committed via `this.commit(stack.move())`...
```

The exception: when the pattern is invisible from the code alone (e.g., "never call
`configure()` in a library package" — the agent can't infer this from reading a single
library). State the rule, link the why.

### 3. Single source of truth across levels

Root AGENTS.md owns shared concerns. Per-package files **defer** to root with a one-line
cross-reference instead of restating.

Good:
```markdown
Commands
Run `build` / `test` / `lint` via turbo (see root AGENTS.md → Commands).
Package-specific: `pnpm --filter @zotlit/db db:pull` — drizzle-kit pull.
```

Bad:
```markdown
Commands
| Command | What it does |
| `pnpm build` | `turbo run build` across the graph |
...
```

Shared code conventions live in `policies/*.md` (see Hierarchy); root AGENTS.md points at them.
Per-package files cover only the local import path or the package-specific deviation.

### 4. Keep it short

- Root: under ~200 lines (this repo's root is the CLAUDE.md, which includes behavioral rules
  that apply to all work — these are legitimate non-inferable content).
- Per-package: under ~100 lines. Most packages need 20–60 lines.
- Policy files: ~3–10 lines. Over 15 is prose that should collapse into a leading word, or reference that should be a skill.
- If approaching the limit, move conventions to `policies/*.md` (at root for repo-wide, at the
  package for package-specific), deep how-to to a skill, or process config to `docs/agents/`.

### 5. Lead with commands

First section after the package title should be exact, executable commands.

### 6. Leading words over prose

A **leading word** is a compact concept already in the model's pretraining (`deep modules`,
`tracer bullets`, `surgical changes`, `KISS`, `RAII`). Naming one recruits priors the model
already holds — encoding a whole behavior in fewer tokens than a paragraph spelling it out.

Use at two levels:

- **In AGENTS.md** — the index gloss names the concept and links the file. Stop.
- **Inside policy files** — the header IS the leading word. Spell out only the non-default
  rules the model wouldn't derive from the term alone.

The collapse test: can the policy reduce to a leading word + 2–3 non-default rules? If
removing a bullet and leaving just the leading word wouldn't change agent behavior, the bullet
is a no-op.

Prefer **enforcement over instruction**: when a rule can be checked by tooling — oxlint, types,
dependency-cruiser, a hook — encode it there and delete the AGENTS.md line. Periodically
audit: if tooling now enforces something, the prose line is redundant.

### 7. Policy file shape

A policy file is a rule, not reference:

- No prose paragraphs — the leading word carries the concept; bullets carry non-default
  specifics.
- No multi-line code blocks. If a rule needs code examples, the rule stays as a short policy
  and the examples move to a skill. The policy points at the skill.

The model: `function-parameters.md` — 3 lines, one rule, done.

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
| Code conventions (simplicity, comments, disposal) | `policies/*.md` (root AGENTS.md points) |
| Package-specific API conventions | Per-package |
| Package-specific conventions (domain patterns) | Per-package `policies/*.md` |
| Logging philosophy + structured logging examples | `policies/logging.md` |
| Logging import path + category for this package | Per-package |
| i18n approach (Paraglide) | Root (one line + skill pointer) |
| i18n import path and compilation for obsidian | Per-package |
| Toolchain (mise, pnpm, oxlint) | Root |
| Package-specific linter overrides | Per-package |
| Behavioral rules (truth-first, disagreement) | Root (inline, as leading words) |
| Policy that grew code examples | Rule → policy (short), examples → skill |

## Maintenance rules

- Update AGENTS.md **in the same PR** that changes the convention it documents.
- Add a rule only the **second time** an agent makes the same mistake — one-off corrections
  belong in conversation, not permanent instructions.
- When a skill covers a topic in depth (e.g., `/obsidian-services`, `/valibot`), the AGENTS.md
  entry should be a one-liner pointing at the skill, not a condensed duplicate.
