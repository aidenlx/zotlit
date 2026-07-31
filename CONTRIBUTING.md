# Contributing

> **Alpha stage** — ZotLit v2 is not yet accepting external contributions.
> The APIs, architecture, and plugin surface are still changing rapidly. Once
> the project reaches stable, contribution guidelines (code style, PR process,
> issue triage) will be added here.
>
> Bug reports and feature requests via
> [GitHub Issues](https://github.com/aidenlx/zotlit/issues) are welcome at
> any stage.

## Releasing

Each app's `apps/{app}/package.json#version` is the sole version source.

| App | Tag format | Example |
|---|---|---|
| Obsidian (`@zotlit/obsidian`) | bare semver | `2.0.0-alpha.1`, `2.1.0` |
| Zotero (`@zotlit/zotero`) | `zt-` prefix | `zt-2.0.0-alpha.1`, `zt-2.1.0` |

### Branching model

- **`main`** = stable. Patch-only (`2.0.x`) while a beta exists.
- **`next`** = beta. Next minor/major (`2.1.0-beta.N`).

Fix bugs on `main`, then merge `main` → `next`.

### Version policy

Keep the **beta line strictly ahead of stable**: every `next` version must be
greater than the current `main` version, and `main` stays on patch bumps
(`2.0.x`) until the in-flight beta graduates. Promote the beta to GA by shipping
its release version from `main` (e.g. `2.1.0-beta.N` on `next` → `2.1.0` on
`main`), then re-base `next` onto the next pre-release (`2.2.0-beta.0`).

This is a **maintainer convention, enforced by review** — `pnpm release` does
not block out-of-policy bumps. Double-check the chosen version against the
counterpart line before merging a release PR.

### How to release

1. Check out the target branch (`main` for stable, `next` for beta).
2. Run `pnpm release` — the interactive script bumps the version, syncs
   manifests, commits, pushes, and opens a PR.
3. CI runs format check → lint → test on the PR. Merge when green.
4. On merge, `release.yml` auto-creates the GitHub release and uploads assets,
   the version's Language Packs among them — so a translation fix reaches users
   with the next plugin release.

### Beta cycle

1. **Start the beta.** Branch `next` off `main` (or merge features into it).
   On `next`, run `pnpm release`, pick `preminor`/`prerelease` → `2.1.0-beta.0`.
   Merge the PR (base `next`).
2. **Iterate.** Land feature PRs into `next`. Run `pnpm release` with
   `prerelease` → `2.1.0-beta.1`, `.2`, …
3. **Patch stable mid-flight.** Fix the bug on `main`, `pnpm release` with
   `patch` → `2.0.1`. Merge to `main`, then merge `main` → `next` (resolve the
   `version` conflict toward the beta).
4. **Ship stable.** Merge `next` → `main`, `pnpm release` with `minor` →
   `2.1.0`. Merge to `main`. Then re-base `next` to `2.2.0-beta.0`.

### Distribution channels

| Channel | Obsidian | Zotero |
|---|---|---|
| Alpha / beta | [BRAT](https://github.com/TfTHacker/obsidian42-brat) | `update-beta.json` on the `release` tag |
| Stable | Community plugin store + BRAT | `update.json` on the `release` tag |
