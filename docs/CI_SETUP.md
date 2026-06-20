# CI & Release Setup

One-time setup for the GitHub Actions pipeline. Day-to-day releasing is covered
in [CONTRIBUTING.md](../CONTRIBUTING.md#releasing); this doc is for the repo
owner bootstrapping the automation.

## Workflows

| File | Trigger | Does |
|---|---|---|
| `.github/workflows/ci.yml` | PR to `main` / `next` | format check → lint (type-aware) → test, with inline annotations |
| `.github/workflows/release.yml` | push to `main` / `next` | parallel `obsidian` + `zotero` jobs: build, create the GitHub release, upload assets, attest provenance |

Both authenticate with the built-in `GITHUB_TOKEN` — **no PAT or repo secret is
required**. Release notes/tags are derived from `apps/{app}/package.json#version`.

## Repository settings (one-time)

Settings → **Actions → General**:

- **Actions permissions:** allow workflows to run.
- **Workflow permissions:** the release workflow declares its own
  `permissions:` block (`contents: write`, `pull-requests: write`,
  `id-token: write`, `attestations: write`), which overrides the repo default.
  Leave the default at *Read repository contents* unless an org policy forbids
  the explicit elevation — in that case raise it to *Read and write*.
- **Allow GitHub Actions to create and approve pull requests:** not required —
  the release PR is opened locally by `pnpm release` (your `gh`), not by CI.

`id-token: write` + `attestations: write` drive
[build provenance](https://docs.github.com/actions/security-guides/using-artifact-attestations).
This works out of the box on public repos; on private repos it needs a plan
that includes artifact attestations.

## Branches

- `main` = stable, `next` = beta. Create both before the first release.
- Protect them so changes land via PR (CI gates the PR; the release fires on
  merge). See the branching model in
  [CONTRIBUTING.md](../CONTRIBUTING.md#branching-model).

## Zotero auto-update: the rolling `zotero-release` host

Zotero auto-update is served from a **single permanent GitHub release tagged
`zotero-release`**. It hosts the Mozilla-format update manifests as assets:

| Asset | Channel | Served to |
|---|---|---|
| `update.json` | stable | stable installs |
| `update-beta.json` | beta | stable + prerelease installs |

The `update_url` compiled into **every shipped XPI** resolves to an asset on
this release, e.g.
`https://github.com/aidenlx/zotlit/releases/download/zotero-release/update.json`
(see `apps/zotero/scripts/release-constants.ts`). Per-version XPIs live on their
own `zt-<version>` releases; the `zotero-release` tag only carries the update pointers.

> **Do not delete or rename the `zotero-release` tag/release.** Doing so breaks
> auto-update for every installed copy.

### Bootstrap the host manually — required before the first Zotero release

`release.yml` does **not** create the `zotero-release` host. By design, the
`zotero` job fails if it is missing or empty:

- `Download current update manifests` runs
  `gh release download zotero-release …` with no `|| true`, so a missing host
  (or one with no `update*.json` assets) errors.
- `Refresh update channel` runs `gh release edit zotero-release`, which errors
  rather than recreating the host.

This is deliberate: silently recreating an absent host would let the
version-gate see no existing entry and clobber a newer beta. If a job 404s on
the host, **fix it by setting up the release properly** with the steps below,
then re-run the job.

Run once, from a clean checkout of the first-release version. This reuses the
same generator the CI does (`build-update-json.ts`) and publishes its output
with `gh`:

```sh
# 1. Build the production XPI into apps/zotero/dist/.
pnpm --filter @zotlit/zotero build

# 2. Generate the channel manifests from that XPI. build-update-json.ts writes,
#    into apps/zotero/dist/: update-beta.json (always), update.json (stable
#    versions only), and release-host-notes.md (the host's release body).
node apps/zotero/scripts/build-update-json.ts

# 3. Create the permanent host release (prerelease, never "Latest"), seeding its
#    body from the generated notes.
gh release create zotero-release \
  --title "Release Manifest" \
  --notes-file apps/zotero/dist/release-host-notes.md \
  --prerelease --latest=false

# 4. Upload the generated manifests as the host's assets.
for f in apps/zotero/dist/update*.json; do
  gh release upload zotero-release "$f" --clobber
done
```

The `update_link` in those manifests points at the first `zt-<version>`
release's XPI, which the first `release.yml` run creates — so it resolves once
that run completes. From then on every run `edit`s this same release and
`--clobber`s the assets, so the manual seed and the automated flow converge.

## How a release flows

0. **One-time:** bootstrap the `zotero-release` host (above) before the first
   Zotero release — `release.yml` requires it and won't create it.
1. `pnpm release` (local) bumps the version, runs quality gates, and opens a PR.
2. `ci.yml` gates the PR (format/lint/test).
3. On merge, `release.yml` runs. Each job's **tag-existence gate** makes it
   idempotent: if the tag (`<version>` for Obsidian, `zt-<version>` for Zotero)
   already exists, the job is a no-op. Pushes that don't bump the version do
   nothing.
4. The `zotero` job downloads the current manifests off the `zotero-release` host,
   version-gates them so a stable patch never clobbers an active beta in
   `update-beta.json`, then `edit`s the host and re-uploads the assets.
