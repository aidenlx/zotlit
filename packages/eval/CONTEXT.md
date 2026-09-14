# Agent Eval

The agent evaluation platform: it stores skill evaluation cases, aggregates
their run gradings into benchmark statistics, and probes whether a skill's
description makes an agent load it.

## Language

**Case**:
One evaluation workspace for a skill — an iteration directory holding
`evals.json`, the per-eval run gradings, and the supporting evidence.
_Avoid_: benchmark, eval suite

**Case Root**:
The committed `cases/` directory that holds every Case, including retained
historical evidence and new Iterations.

**Iteration**:
A numbered generation of trials for one Case. A newer iteration supersedes an
older one for resolution, while both stay on disk.
_Avoid_: run, round

**Eval**:
One task inside a Case: a prompt, its expected output, and the assertions that
grade it.
_Avoid_: test, case

**Eval Directory**:
A Case subdirectory holding one Eval's configuration directories. The graded
Eval Directory is named `eval-<n>`; a directory named after the Eval restates a
trial already graded under `eval-<n>`, so the graded one is authoritative and
the named duplicate is skipped.
_Avoid_: run dir, trial folder

**Run**:
One execution of an Eval under one configuration, recorded as `grading.json`.
A Configuration either splits its Runs into `run-<n>` directories or holds its
grading directly, which counts as run 1.
_Avoid_: trial attempt

**Configuration**:
The arm a Run belongs to — `with_skill` or `without_skill`. The delta is the
first configuration's mean minus the second's.
_Avoid_: variant, variant arm

**Trigger probe**:
One non-interactive agent process that answers whether the agent read the
skill. The trigger rate is the share of probes that read it.
_Avoid_: trigger test, activation check
