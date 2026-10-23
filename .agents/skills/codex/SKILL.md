---
name: codex
description: Delegate bulk labour or a code review to the Codex CLI while Claude stays the lead. Use for classifying or auditing many files, mass edits, executing a written plan, running a review through Codex, or any task the user says to hand to Codex.
---

# Codex as the labour

Claude is the **lead**: it owns the rubric, the spec, every keep/delete call, the review, and the commit. Codex executes. A Codex report is a claim; the lead's review turns it into a fact.

## 1. Write the spec

Put it in `.scratch/<task>/SPEC.md`, so Codex reads it from the shared temp dir. It holds:

- what to change and why, with the files to read first;
- **out of scope**: files the lead edits;
- **commits**: "do not commit", or the branch Codex commits on when the work is a ticket in its own worktree (`implement-spec`);
- **done when**: a checkable criterion per item, ideally a probe that goes red then green, and the commands to run;
- **report**: files changed, each command with its result, choices the lead should check.

Done when every item has a done-when line Codex can run.

## 2. Run it

```bash
codex exec -m <model> -c model_reasoning_effort='"high"' --approve-for-me \
  -C <worktree> --add-dir <main checkout>/.git --add-dir <repo>/.scratch/<task> \
  --ephemeral --color never -o .scratch/<task>/report.md \
  "Read <absolute path to SPEC.md> and carry it out exactly." < /dev/null > .scratch/<task>/log.txt 2>&1
```

Run it in the background; the harness notifies on exit.

- **Model:** `gpt-6.1-sol` by default; the model the user names otherwise (`gpt-6-astra`).
- **Approvals:** `--approve-for-me` grants Codex's own approval requests. Use it alone: without `-s`, and never with `approval_policy="never"`, which the auto-mode classifier denies as an unsafe agent.
- **Fast mode:** add `-c service_tier='"priority"'` when the user asks for fast mode (2x speed, more usage). `~/.codex/models_cache.json` lists each model's tiers under `service_tiers`.
- **Prompt:** the prompt is always the one sentence that points at the spec file. Prompt text that quotes a `git` command makes a worktree-isolated session refuse the launch.
- **Writable dirs:** a `wt` worktree keeps its git data in the main checkout, so `--add-dir` that checkout's `.git` (`git rev-parse --git-common-dir`) for Codex to commit. Add `--add-dir` for the `.scratch/<task>` dir when Codex runs in another worktree, and for any cache outside the worktree that the build writes to.
- **Audits:** for an audit or classification, the spec says "change no files".
- **Changing a running spec:** stop the run, edit the spec, and relaunch with a line telling Codex to read its uncommitted edits with `git diff` and continue from them.
- **Slices:** for a many-file audit or cleanup, split by directory into slices of similar size, one `codex exec` per slice in parallel, each writing its own report and a ledger (`path | action | reason | retained cover`). Slices that edit the same worktree must not share files.
- **Desktop work** (e2e runs, the desktop lock, a running Obsidian or Zotero): the `workspace-write` sandbox blocks `ps` and the app sockets. Run with `-p desktop`, the full-access profile in `~/.codex/desktop.config.toml`, and say so in the spec; one desktop run at a time. When that file is missing, ask the user to create it rather than widening the sandbox yourself.

### Code review

`codex exec review` reviews a diff instead of executing a spec. Verified on `codex-cli 0.164.0`; check `codex exec review --help` when the version moves.

```bash
codex exec -C <worktree> review -m <model> -c model_reasoning_effort='"xhigh"' --title "<title>" \
  -o .scratch/<task>/review.md "Read <absolute path to brief.md> and carry it out exactly." < /dev/null > .scratch/<task>/review-log.txt 2>&1
```

- **Worktree:** `-C` is an option of `codex exec`, so it goes before `review`. Placed after `review`, it fails with a usage error.
- **Scope:** a prompt and a scope flag (`--base`, `--uncommitted`, `--commit`) are mutually exclusive. A briefed review names its scope inside the brief: "Review the diff from `git diff <fixed-point>...HEAD`, commits: `<list>`."
- **Report only:** the brief ends with "Report findings only. Change no files."
- **Approvals:** `review` has no `--approve-for-me`. It takes approvals from `~/.codex/config.toml`: `approvals_reviewer = "auto_review"`, `approval_policy = "on-request"` and `sandbox_mode = "workspace-write"`. Pass them as `-c` overrides on a machine whose config differs.
- **Usage errors:** a misplaced or unknown flag exits `2` and writes no report. The log holds the usage message.

## 3. Review

- Read the diff, not just the report. Check each done-when probe's pasted output.
- A test failure Codex reports from inside the sandbox is **unconfirmed** until it fails again outside it; sandbox limits (no `ps`, no sockets, no network) produce false failures.
- Fix small slips yourself; send a follow-up spec for anything structural.
- Commit as the lead, with messages that describe the change, not who made it.

Done when the lead's own run of the repo's gate passes on the final tree.
