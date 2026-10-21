---
status: proposed
---

# Checks run before push, and CI runs only to release

Amends [ADR 0020](0020-obsidian-guideline-review-runs-on-eslint-at-release.md): the release-time backstop for the Obsidian guideline review moves from `plugin-review.yml` into `release.yml`.

`pnpm verify` is the one quality gate. Lefthook runs it before every push, so a branch is checked before it reaches GitHub. Pull requests run no checks. GitHub Actions does the work that needs GitHub: it publishes releases, deploys the docs, and triages issues.

```
feature branch ──push──▶ pre-push: pnpm verify          (changed packages + dependents)
                         └─ PR into next ── merge ─ no checks

pnpm release ── pnpm verify --release ── release branch ── PR ── merge (same command)
                (every package + pnpm review)                      │
                                                                   ▼
                              release.yml:  plan ──▶ verify ──▶ obsidian / zotero publish
                                            tag exists? stop     pnpm verify --release
```

`pnpm verify` checks format, the regenerated contract artifacts and template data page, lint, typecheck, snapshot size, and tests. Without a flag it scopes typecheck and tests with Turbo `--affected`, measured from the nearer of `origin/next` and `origin/main`. `--release` checks every package and adds `pnpm review`. On the desktop it also runs the full End-to-end Run and `pnpm e2e:worker`, and an unreachable Obsidian fails it. The hosted runner has no desktop, so `release.yml` skips that step and the End-to-end Run gates only the local `pnpm release`.

`release.yml` runs on every push to `main` and `next`. Its `plan` job stops in seconds when both app versions already have releases. For a new version, the `verify` job runs `pnpm verify --release` on the merged tree before either publish job starts. That job is the check that a push which skips its hooks cannot skip, and it checks the tree that ships, which includes whatever the target line gained after the local run.

## Why

The repository has one maintainer, and coding agents write most of the commits. Pull-request CI exists to keep many contributors' work consistent, and here it added only waiting time. Agents push often, and each push started a full run that repeated checks the agent had just run. A local gate fails in the same session that caused the failure. A failed CI run comes back after the session has moved on.

The local gate also has more capacity than the hosted runner. The runner had 4 vCPU and ran test packages one at a time. Turbo's local cache carries results across branches and worktrees.

## Consequences

- A failed `verify` job leaves a version commit on its line with no release. The recovery is one step: land the fix, then run `release.yml` with `workflow_dispatch`. The tag gate makes the re-run publish only what is missing.
- `release.ts` gates before the version commit exists, so the release PR needs no checks. The script offers to merge the PR as soon as it opens it.
- Nothing on GitHub checks a feature PR. `git push --no-verify` skips the gate. Agents keep the hook on.
- Hooks are the only gate before release, so a hook that fails on machine load teaches its bypass. The worker-responsiveness timing check left pre-commit for the release gate, where the machine is quiet.
- The handoff tips for pull-request CI do not apply here: cancelling superseded runs and skipping drafts both save work that no longer runs. GitHub Actions parallel steps could make the `verify` job faster. That job runs once per release, so it stays sequential until its time matters.

## Considered Options

- **Run checks only on release PRs** (the `vatt-repo` model: CI on PRs into `main`) — this blocks the merge instead of the publish. Without a required status check, nothing makes the merge wait, and `release.ts` could not merge in the same command. It also checks the release branch, not the merged tree.
- **Keep PR CI and add concurrency cancellation and draft skipping** — this makes each wasted run cheaper but keeps a second, slower copy of a gate the maintainer already runs locally.
- **Release from a tag push instead of a release PR** — this removes the PR, but the `main` ruleset requires a pull request, so stable releases still need one. One release path for both lines is simpler than two.
