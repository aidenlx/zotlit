# Contributing

> Contribution guidelines (code style, PR process, issue triage) will be
> added here as the project matures.
>
> Bug reports and feature requests via
> [GitHub Issues](https://github.com/aidenlx/zotlit/issues) are welcome.

## Releasing

Each app's `apps/{app}/package.json#version` is the sole version source.

| App | Tag format | Example |
|---|---|---|
| Obsidian (`@zotlit/obsidian`) | bare semver | `2.0.0`, `2.1.0-beta.1` |
| Zotero (`@zotlit/zotero`) | `zt-` prefix | `zt-2.0.0`, `zt-2.1.0-beta.1` |

### Branching model

- **`next`** = primary working branch. All features and fixes land here.
  Pre-releases (`2.1.0-beta.N`) ship from `next`.
- **`main`** = stable. Receives stable graduations (from `next`) and emergency
  hotfixes (patch-only).

See [ADR 0021](docs/adr/0021-next-is-the-primary-branch.md).

### Version policy

Keep the **beta line strictly ahead of stable**: every `next` version must be
greater than the current `main` version, and `main` stays on patch bumps
(`2.0.x`) until the in-flight beta graduates.

This is a **maintainer convention, enforced by review** — `pnpm release` does
not block out-of-policy bumps. Double-check the chosen version against the
counterpart line before merging a release PR.

### How to release

1. Check out `next` (for pre-releases and stable graduations) or `main` (for
   hotfixes only).
2. Run `pnpm release` — the interactive script bumps the version, syncs
   manifests, runs the release gate (`pnpm verify --release`, which includes
   the End-to-end Run, so desktop Obsidian must be running), commits,
   pushes, opens a PR, and offers to merge it. The PR target is inferred from
   the version picked: a non-prerelease version on `next` targets `main` (stable
   graduation); a prerelease targets `next`; on `main`, all releases target
   `main`.

   To release without prompts, name each app and its version — a bump the
   picker offers on that branch, or an explicit version:

   ```sh
   pnpm release --obsidian prerelease            # stop at the open PR
   pnpm release --obsidian 2.2.0-beta.5 --merge  # also merge the PR
   pnpm release --obsidian minor --zotero minor  # stable graduation from next
   ```

   Every confirmation is taken as yes; the PR merges only with `--merge`. A
   branch with commits not yet on origin stops the run: push them first.
3. Pull requests run no checks: the pre-push hook runs `pnpm verify`, and the
   release gate already passed in step 2. See
   [ADR 0076](docs/adr/0076-checks-run-before-push-and-ci-runs-only-to-release.md).
4. On merge, `release.yml` runs the release gate on the merged tree, then
   auto-creates the GitHub release and uploads assets. If its `verify` job
   fails, nothing publishes: land the fix and re-run the workflow from the
   Actions tab.
   The Obsidian job cuts **two** releases per version: `<version>` with the three
   files the community-plugin scanner accepts, and `res-<version>` with the
   version's Language Packs and template data JSON Schemas — so a translation fix
   reaches users with the next plugin release. See
   [docs/CI_SETUP.md](docs/CI_SETUP.md#the-resource-release-res-version).

### Pre-release cycle

1. **Start the beta.** On `next`, run `pnpm release`, pick
   `preminor`/`prerelease` → `2.1.0-beta.0`. Merge the PR (targets `next`).
2. **Iterate.** Land feature PRs into `next`. Run `pnpm release` with
   `prerelease` → `2.1.0-beta.1`, `.2`, …
3. **Ship stable.** On `next`, run `pnpm release`, pick `minor` → `2.1.0`.
   The script creates a release branch targeting `main`. Both apps must be
   selected and must graduate together. Merge the PR to `main`.
4. **Sync back.** Merge `main` → `next` (resolve version conflicts toward the
   next prerelease). Then run `pnpm release` on `next` with `preminor` →
   `2.2.0-beta.0`.

### Hotfix path

For urgent stable patches (security fixes, regressions) while `next` has
unreleased features:

1. Fix the bug directly on `main`. Run `pnpm release` with `patch` → `2.0.2`.
   Merge to `main`.
2. Cherry-pick the fix into `next`.

### Distribution channels

| Channel | Obsidian | Zotero |
|---|---|---|
| Pre-release | [BRAT](https://github.com/TfTHacker/obsidian42-brat) | `update-beta.json` on the `release` tag |
| Stable | Community plugin store + BRAT | `update.json` on the `release` tag |
