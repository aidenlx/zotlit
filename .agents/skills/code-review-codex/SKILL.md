---
name: code-review-codex
description: Run the two-axis code review through the Codex CLI (GPT) instead of Claude sub-agents.
disable-model-invocation: true
---

Same two axes as [`code-review`](../code-review/SKILL.md) — **Standards** and **Spec** — reviewed by `codex exec review` instead of Claude sub-agents, so a second model reads the diff.

## Process

### 1. Pin the fixed point and the sources

Steps 1-3 of [`code-review`](../code-review/SKILL.md) are the source of truth for this: pin the fixed point, confirm `git rev-parse <fixed-point>` resolves and the diff is non-empty, find the spec, and collect the standards sources plus the smell baseline. Read that skill now.

### 2. Run both axes

One `codex exec review` per axis, both started in the background so they run in parallel:

```bash
codex exec review -m gpt-6-astra -c model_reasoning_effort="xhigh" \
  --title "Standards" -o tmp/review-standards.md "<brief>"
```

Each brief is the matching sub-agent brief from `code-review` step 4, plus two lines Codex needs:

- The scope in words — for example "Review the diff from `git diff main...HEAD`, commits: `<list>`." A custom prompt bars the scope flags, so the prompt carries the scope itself.
- "Report findings only. Change no files."

Paste the standards sources and the smell baseline into the Standards brief; paste the spec path or contents into the Spec brief. Codex reads the repo itself, so a path is enough for a file that is in the repo.

When the spec is missing, run the Standards axis alone and say so in the report.

### 3. Aggregate

Step 5 of [`code-review`](../code-review/SKILL.md): the two reports under `## Standards` and `## Spec`, unranked and unmerged.

## Flags

Verified on `codex-cli 0.153.4`. Check `codex exec review --help` when the version moves.

| Need | Flag |
| --- | --- |
| GPT-6 | `-m gpt-6-astra` |
| Deep reasoning | `-c model_reasoning_effort="xhigh"` — overrides the `low` default in `~/.codex/config.toml` |
| Report to a file | `-o <path>` (workspace `tmp/`) |
| Event stream | `--json` |

Gotchas the CLI help states softly:

- A prompt and a scope flag are mutually exclusive: `--base`, `--uncommitted`, and `--commit` each reject `[PROMPT]`. Pick a scope flag for a plain review, or a prompt that names the scope for a briefed one.
- A flag-parse error still exits `0`. Read stderr to detect it.
- `--approve-for-me` exists on `codex` and `codex exec`, and not on the `review` subcommand. Approvals come from `~/.codex/config.toml` instead: `approvals_reviewer = "auto_review"`, `approval_policy = "on-request"`, `sandbox_mode = "workspace-write"`. Pass them as `-c` overrides on a machine whose config differs.
