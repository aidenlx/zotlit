# Retained evaluation evidence

The [final recovery probe](final-recovery/transcript.md) retains three complete
JSON responses from the rebuilt and reloaded `c37419836` bundle. It is an
operator verification of the recovery fix, excluded from Luna run totals.

A [fresh Luna xhigh recovery trial](final-recovery-luna3/transcript.md) on
the same final bundle records four commands and exact stdout: status plus
three recovery commands. It succeeds after applying the omission hint.
It is one supplemental trial, bringing retained Luna trials to four while
the original comparison benchmark remains three. This transcript has no
reset snapshot, elapsed durations, or token totals.

The broader fixed-case and fresh-Vault-Case evaluation gap these trials left
open is now closed by the reset-isolated matrix in
[../fresh-cases/results.md](../fresh-cases/results.md), which runs all nine
Workbench Vault Cases with a rebuilt seed and a purged Development Vault
before every run. The records below stay the historical three-trial
benchmark; they are not part of that matrix.

The files here preserve the recorded Luna trials. The original scratch paths
remain in command text as historical inputs. Reviewers can read all cited
evidence from this directory without access to those paths.

| Trial | Prompt record | Command and result evidence | Source artifacts |
| --- | --- | --- | --- |
| Spread, with skill | ../evals.json, json-e-spread | [Transcript](with_skill/transcript.md) | [Checked draft](with_skill/books-profile-draft.md) |
| Spread, without skill | ../evals.json, json-e-spread | [Transcript](without_skill/transcript.md), [structured outputs](without_skill/evaluation-output.json) | [Original](without_skill/books-profile-original.md), [draft](without_skill/books-profile-draft.md), [preservation](without_skill/preservation-report.json) |
| Citation/partial, with skill | ../evals.json, citation-partial-heldout | [Transcript](heldout_with_skill/transcript.md) | Source excerpts and revisions are in the transcript |

The spread prompt was evaluated as a scratch-only edit: preserve installed
Profiles and notes, and verify create or update previews. The prompt text in
evals.json is the task record; the original complete agent-dispatch envelope
was not retained. Transcript commands and result summaries preserve the
actions actually taken. They are agent-authored evidence records, not raw
runtime event exports. Baseline structured outputs retain selected JSON
response fields; truncated raw excerpts are marked in its transcript.

## Identity and reset record

All three trials used Obsidian 1.14.1, plugin 2.1.4, Contract 7, source
`8a19f09e`, vault `fixture-vault-zotlit-v2` (ID `bd0ea1a22beb8f55`),
and Profile Books (ID `V1StGXR8Z5jd`). Runtime identity responses appear in
the transcripts and the baseline structured outputs.

The shared starting Books Profile revision was
`99d3f5f5002545255ea5440eb51d2db264e2f3dd712d4f352457bc62e04d1543`.
Both spread drafts have revision
`c0ccb4af9d1178a73cff9a42efb99d0da5fcf6aaeb5853d9333f8486c0b7558c`.
The shared partial revision was
`9db8c823b54163890b1e87789817230d2fc83a7e625a6ceff4784d5d84c8c08f`.
The checked existing note revision was
`98ae1a1495fc6f983e9d23c88f35f8f8ea8844088e2648df2e10205a5a881d8f`.

There was no fresh Vault Case reset between these three initial trials.
They used a configured shared vault with scratch-only edits and preview
checks. The baseline records a final byte comparison of the installed
Profile against the original and final Profile/partial/note hashes. The
candidate records its one-line draft diff and preserved update output.
The held-out run was read-only. There is no complete independent pre/post
vault snapshot for each Luna trial; these records do not prove reset-based
isolation or repeatability.

The external-edit and standalone-draft live probes in ../report.md were
operator probes, not additional Luna runs. Their detailed outcome summary
and aggregate vault hash are retained there; raw command outputs for those
probes were not retained. The report records that the changed partial was
restored. The earlier read-only trial is preserved in
[prior-iteration.md](prior-iteration.md) and excluded from benchmark totals.

## Measurement scope

The benchmark counts 15, 30, and 36 listed Obsidian invocations for the
candidate spread, baseline spread, and held-out trial respectively. The
baseline includes commands listed again in its earlier-discovery section.
Tool-call totals and complete trial durations were not available. Its ten
measured verification command durations total 695 ms; this is a partial
command-time sum, not elapsed agent time. All unknown metrics are null.
