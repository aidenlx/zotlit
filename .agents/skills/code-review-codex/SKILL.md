---
name: code-review-codex
description: Run the two-axis code review through the Codex CLI (GPT) instead of Claude sub-agents.
disable-model-invocation: true
---

Run [`code-review`](../code-review/SKILL.md) as written, with one change in step 4: each axis runs as a `codex exec review` instead of a Claude sub-agent. Launch it as [`codex`](../codex/SKILL.md) → Code review describes, with `-m gpt-6-astra`. Start both axes in the background so they run in parallel.

Each axis brief is a file in `.scratch/` that holds:
- that axis's step-4 sub-agent prompt;
- a pointer to the smell baseline (`code-review` step 3) in place of a pasted copy, since Codex reads the repo.

Codex writes each report with `-o .scratch/review-<axis>.md`, and step 5 aggregates the two reports.
