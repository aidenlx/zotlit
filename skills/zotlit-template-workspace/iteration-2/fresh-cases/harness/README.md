# Matrix harness

The scripts that ran the reset-isolated matrix recorded in
[../results.md](../results.md). They are kept as the record of how each run was
reset, snapshotted, and gated.

| Script | Purpose |
| --- | --- |
| `reset.sh <case-id>` | Rebuild the seed, open the Development Vault with a purge, then gate on environment integrity. Fails closed unless the plugin answers on the `acceptance-fixture` database with 4 Libraries and all three target Items resolving. |
| `snapshot.sh <case-id> <pre\|post> [tag]` | Hash and archive the graded surface: templates, notes, settings, skill bytes, and the runtime identity block. |
| `gate.sh <agent-id>` | Contamination gate. Probes a subject transcript for the grading manifest, the workspace, and the design history. Any hit discards the run. |
| `settle-missing-partial.sh` | For `workbench-error-recovery` only. After a purge, the running app has not observed the folder swap, so a deleted dependency still reports a stale `loaded` revision. Recreates and deletes the file so the app sees a real deletion, then gates on the `missing-partial` diagnostic. |

Two paths are pinned to the machine that ran the matrix and need retargeting
before reuse: `ROOT` in `reset.sh`, `snapshot.sh`, and
`settle-missing-partial.sh`, and the transcript directory `T` in `gate.sh`,
which points at one agent-session's task output.

Run `gate.sh` after every subject run. `reset.sh` and `gate.sh` fail closed by
design; keep them that way.
