# next is the primary branch

Supersedes [ADR 0011](0011-stable-ships-from-main-betas-ship-from-next.md).

All development happens on `next`. The `main` branch receives stable graduations (via release-branch PRs that originate from `next`) and emergency hotfixes (patch-only, applied directly on `main` and cherry-picked back to `next`). `next` is never dormant — it is the standing working branch for features, fixes, and pre-releases alike.

`release.ts` infers the release line from the **version** picked, not the branch. A non-prerelease version (e.g. `2.1.0`) on `next` creates a release branch targeting `main`; a prerelease version (e.g. `2.1.0-beta.6`) targets `next`. On `main`, only `patch` and `custom` bumps are offered (hotfix path).

## Guards

| Guard | When | Effect |
|---|---|---|
| Ancestry check | Stable graduation from `next` | Aborts if `origin/main` is not an ancestor of `HEAD` — prevents regressing a hotfix. |
| All-apps gate | Stable graduation from `next` | Requires both Obsidian and Zotero to be selected — apps graduate together. |
| Mixed-version gate | Any release from `next` | Aborts if some apps get stable versions and others get pre-release — one PR cannot target two branches. |
| Version-picker filtering | Always | On `main`: only `patch` + `custom`. On `next` with a prerelease current version: hides `patch` and `prepatch` (nonsensical from a prerelease base). |

## Considered Options

- **Keep ADR 0011 as-is** (rejected): the dormancy model — `next` goes dormant between beta cycles, all work ships from `main` — does not match the actual workflow, where `next` is always the active branch. Bug-first-on-`main` requires context-switching that slows daily development.
- **Trunk-based with `main` as the primary branch** (rejected): same reasoning as ADR 0011's rejection — beta work and stable patches interleave, making clean stable releases impossible without reverting or gating.
- **`next`-primary with release-branch promotion** (chosen): daily work lands on `next`, pre-releases ship from `next`, and stable graduations are release-branch PRs from `next` targeting `main`. Hotfixes can still land directly on `main` for emergencies.

## Consequences

- `next` is always the default PR target for feature and fix branches.
- `main` advances only via stable-graduation PRs or direct hotfix PRs. It stays on patch-only bumps between graduations.
- Stable graduation requires all apps. Single-app stable releases go through the hotfix path on `main`.
- After a stable graduation merges to `main`, merge `main` back into `next` (resolve version conflicts toward the next prerelease), then bump `next` to the next prerelease via `pnpm release`.
- After a hotfix merges to `main`, cherry-pick it into `next` manually.
- The "beta strictly ahead of stable" invariant remains convention-only.
- Root `manifest.json` / `versions.json` are still regenerated only by stable releases; the graduation PR carries them to `main`.
- CI (`release.yml`) triggers on pushes to both `main` and `next` — no workflow changes required. The release channel is still derived from the semver prerelease component.
