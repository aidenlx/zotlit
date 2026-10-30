---
name: codex
description: Delegate bulk labour or a code review to the Codex CLI while Claude stays the lead. Use for classifying or auditing many files, mass edits, executing a written plan, running a review through Codex, continuing or handing off a Codex run, or any task the user says to hand to Codex.
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
  --color never -o .scratch/<task>/report.md \
  "Read <absolute path to SPEC.md> and carry it out exactly." < /dev/null > .scratch/<task>/log.txt 2>&1
```

Run it in the background; the harness notifies on exit.

- **Session:** the run above keeps its session, and the log's header prints `session id: <uuid>`. Keep the session for work that can need a second turn: a ticket, an implementation, anything the lead reviews and sends back. Add `--ephemeral` to a one-shot whose report is the whole product (an audit, a classification, a slice, a review): an ephemeral session cannot be resumed, so a stop leaves only `log.txt` to recover from.
- **Provider:** `~/.codex/config.toml` decides it. Read it with `rg -n '^model|^base_url' ~/.codex/config.toml`: the file holds an API key, so print only those lines.
  - **Subscription** (no `model_provider` line): `gpt-6.1-sol` by default; the model the user names otherwise (`gpt-6-astra`). `~/.codex/models_cache.json` lists the models.
  - **DeepSeek** (`model_provider = "custom"`, `base_url` at `api.deepseek.com`): `-m deepseek-flash`, with the command above unchanged. A read-only audit ran clean this way on `codex-cli 0.164.0`. `models_cache.json` has no DeepSeek model, so the name comes from the config's `model` line. Edits, `codex exec review` and fast mode are untried there: probe with a read-only spec before handing over real work.
- **Approvals:** `--approve-for-me` grants Codex's own approval requests. Use it alone: without `-s`, and never with `approval_policy="never"`, which the auto-mode classifier denies as an unsafe agent.
- **Fast mode:** add `-c service_tier='"priority"'` when the user asks for fast mode (2x speed, more usage). `~/.codex/models_cache.json` lists each model's tiers under `service_tiers`.
- **Prompt:** the prompt is always the one sentence that points at the spec file. Prompt text that quotes a `git` command makes a worktree-isolated session refuse the launch.
- **Writable dirs:** a `wt` worktree keeps its git data in the main checkout, so `--add-dir` that checkout's `.git` (`git rev-parse --git-common-dir`) for Codex to commit. Add `--add-dir` for the `.scratch/<task>` dir when Codex runs in another worktree, and for any cache outside the worktree that the build writes to.
- **Audits:** for an audit or classification, the spec says "change no files".
- **Slices:** for a many-file audit or cleanup, split by directory into slices of similar size, one `codex exec` per slice in parallel, each writing its own report and a ledger (`path | action | reason | retained cover`). Slices that edit the same worktree must not share files.
- **Memory:** each run starts its own test and build processes. Two or three parallel runs plus other sessions can push the machine into memory pressure, and the harness then kills the background runs. Start with two parallel runs and tell each to run one heavy check at a time.
- **Desktop work** (e2e runs, the desktop lock, a running Obsidian or Zotero): the `workspace-write` sandbox blocks `ps` and the app sockets. Run with `-p desktop`, the full-access profile in `~/.codex/desktop.config.toml`, and say so in the spec; one desktop run at a time. When that file is missing, ask the user to create it rather than widening the sandbox yourself.

### Continue a run

`resume` continues a kept session with its context: a review round, a changed spec, a handoff after a stop. Verified on `codex-cli 0.163.0`; check `codex exec resume --help` when the version moves.

```bash
codex exec -m <model> -c model_reasoning_effort='"high"' --approve-for-me \
  -C <worktree> --add-dir <main checkout>/.git --add-dir <repo>/.scratch/<task> \
  --color never -o .scratch/<task>/followup.md \
  resume <session id> "Read <absolute path to FOLLOWUP.md> and carry it out exactly." < /dev/null > .scratch/<task>/followup-log.txt 2>&1
```

- **Options:** `-C`, `--add-dir` and `--approve-for-me` belong to `codex exec`, so they go before `resume`; `-m`, `-c` and `-o` work on either side. Repeat the options of the first run.
- **Follow-up spec:** a file, like the first spec, holding the findings to fix or the changed requirement. The session already knows the rest.
- **Changing a running spec:** stop the run, edit the spec, and resume with a line telling Codex to re-read the spec and its uncommitted edits (`git diff`).
- **Handoff:** to take over a run, stop the process and resume its session with a spec that asks for `.scratch/<task>/HANDOFF.md`: each criterion's state with its evidence, the design so far, open questions, the last result of every check, the remaining steps in order, and "change no other file". The session recalls reasoning the log does not hold.
- **Lost session:** a run started with `--ephemeral`, or one whose id was never read, restarts with a fresh spec that tells Codex to read `log.txt` and the worktree's `git diff`.

### Code review

`codex exec review` reviews a diff instead of executing a spec. Verified on `codex-cli 0.164.0`; check `codex exec review --help` when the version moves.

```bash
codex exec -C <worktree> review -m <model> -c model_reasoning_effort='"xhigh"' --ephemeral --title "<title>" \
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
- Fix small slips yourself; send a follow-up spec (resume the session) for anything structural.
- Commit as the lead, with messages that describe the change, not who made it.

Done when the lead's own run of the repo's gate passes on the final tree.
