# Fresh-case live trial configuration — issue #1093

Recorded at the start of the reset-isolated live matrix. Identity comes from the
live runtime, never from a historical constant.

## Environment identity (this matrix)

| Fact | Value |
| --- | --- |
| Workspace | /Users/aidenlx/worktrees/zotlit-v2/codex-issue-1086 |
| Branch / HEAD | codex/issue-1086 @ 6e2efe8c1 |
| CLI contract | 7 (`template-status` → `contractVersion`) |
| Plugin version | 2.1.4 |
| Obsidian host | 1.14.1 (installer 1.13.7) |
| Zotero source id | per-run; each rebuild mints a new id (e.g. `1f2064de`, `2d165fa1`) — captured in every snapshot |
| Zotero database | tmp/acceptance-fixture/zotero-data/zotero.sqlite |
| Vault name pattern | fixture-vault-codex-issue-1086-<case-id> |
| Skill under test | skills/zotlit-template/SKILL.md, sha256 91833f92…5763bdf5 (3029 bytes) |

The historical environment (`source 8a19f09e` / `vault bd0ea1a22beb8f55`,
model gpt-5.6-luna) is prior comparison metadata only. It is not this
environment's identity.

## Subject configuration

| Setting | Value |
| --- | --- |
| Evaluation model | claude-sonnet (fresh context per run) |
| Paired Zotero | not launched; Obsidian alone against the generated SQLite database |
| Candidate arm | reads skills/zotlit-template/SKILL.md, follows it |
| Baseline arm | no skill; same CLI, same rebuilt initial state |
| Context isolation | subjects receive only environment facts and the user task |
| Withheld from subjects | assertions, prescribed solutions, design history, grading |

## Reset procedure per run

1. `pnpm fixture build --vault-case <case-id>`
2. `node packages/scripts/scripts/obsidian-vault.ts open --vault-case <case-id> --purge`
3. `tmp/fresh-cases-runs/snapshot.sh <case-id> pre <arm>`
4. dispatch fresh subject
5. `tmp/fresh-cases-runs/snapshot.sh <case-id> post <arm>`
6. grade from disk bytes and command output, independent of the subject's report

Case mutations run sequentially: the generated database under
tmp/acceptance-fixture is shared across cases in this worktree.

## Status

Live loop verified: case vault `6dbd660ad51c7cba` registered and answering on
Contract 7. Per-case results are recorded in results.md as they complete.
