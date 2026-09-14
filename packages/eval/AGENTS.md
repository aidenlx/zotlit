# @zotlit/eval

The agent evaluation platform: it stores skill evaluation Cases, aggregates their run
gradings into benchmark statistics, and probes whether a skill's description makes an agent
load it. See `CONTEXT.md` for the glossary (Case, Iteration, Eval, Eval Directory, Run,
Configuration, Trigger probe).

## Commands

Run `test` / `lint` via turbo (see root AGENTS.md → Commands). Package-specific:

- `pnpm eval list` (root) — lists the Cases under `cases/`.
- `pnpm eval benchmark <case>` — writes `benchmark.json` and `benchmark.md` for a Case.
- `pnpm eval inspect <case>` — prints a Case's eval set and graded run count.
- `pnpm eval trigger <skill-path> --evals <file>` — probes whether pi loads the skill.

`<case>` accepts a case id, a path under `cases/`, or an absolute path. The tree is empty, so
`list` reports that until a Case is added.

## Case layouts

The Case tree is empty: `cases/` holds no Case, because the historical Case's evidence was
deleted rather than re-run. The loader below is what a re-run targets.

A Case directory holds Iterations, each with an `evals.json` and its gradings. A
configuration holds its grading in one of two layouts, and the loader accepts both:

- `<configuration>/run-<n>/grading.json` — runs split across numbered directories.
- `<configuration>/grading.json` — one run recorded in place, counted as run 1.

An eval-named directory restates a trial already graded under an `eval-<n>` directory. Count
each trial once: the `eval-<n>` directory wins and the eval-named duplicate is skipped. A
Case that has only eval-named directories still loads.

Eval identity resolves in this order: `evals.json` matched on the directory name, then
`eval_metadata.json`'s `eval_name` matched against `evals.json`, then its `eval_id`, then the
directory name.

## Recorded metrics

A grading may carry `timing` and `execution_metrics`; most do not. Absent metrics aggregate
as `0`, not `null`.

## Trigger probes

`trigger` spawns `pi --mode json --skill <path> -p <query>` and watches the JSON event
stream for a tool call that reads the skill. pi loads the skill through `--skill`, so there
is no command-file shim. Probes need a configured model and a live pi process; they stay out
of `pnpm test`.

## Provenance

The harness is a TypeScript port of the vendored `skill-creator` scripts under
`.agents/skills/skill-creator/scripts/` (Python, licensed — leave in place). The port drops
`generate_report.py`, `improve_description.py`, `quick_validate.py`, `package_skill.py`,
`run_loop.py`, and `eval-viewer/`, which this repo does not use.
