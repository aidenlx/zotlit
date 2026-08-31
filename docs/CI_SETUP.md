# CI setup

GitHub Actions uses the toolchain pinned in `mise.toml` and the pnpm version in
the root `package.json`. Repository workflows call the local
`.github/actions/setup-workspace` action, which restores both caches and then
runs `mise run init --no-submodules`. A call that passes `bootstrap: "false"`
keeps the toolchain and the caches and stops before the initializer.

1. The pnpm store cache is keyed from `pnpm-lock.yaml` by
   `pnpm/action-setup`.
2. The local Turborepo cache is restored from `.turbo` by `actions/cache`.

Each job writes a distinct Turbo cache entry. Restore prefixes first prefer the
same workflow and job, then allow compatible entries from other workflows on
the same runner operating system. Turbo task hashes remain the authority for
whether an individual result is reusable.

The setup action records the effective Node and pnpm versions in
`ZOTLIT_TOOLCHAIN`. The root Turbo configuration includes that value and
`mise.toml` in its global hash. A toolchain change therefore invalidates cached
tasks even when package source files are unchanged.

## Docs deployment

`.github/workflows/docs-deploy.yml` deploys Stable Docs from `main` and
Pre-release Docs from `next`. Manual dispatch always deploys. For a push, the
gate job asks Turbo whether the push changed `@zotlit/docs` or its dependency
closure. An unavailable base commit, a force push, a change to the deploy
workflow or to the setup action, or a failed Turbo query deploys instead of
skipping.

The gate job checks out the full history, which the base-commit comparison
needs, and stops before dependency installation. The deploy job runs only when
the gate reports a deployment, and starts from its own checkout.

The deploy job initializes `packages/zotero-types/zotero-schema` alone. The
Obsidian API and PDF.js submodules are outside the docs build. The job installs
`@zotlit/docs` and its dependency closure with a pnpm filter, then lets
`turbo run build --filter=@zotlit/docs` build dependencies in graph order.

The docs build reads `GITHUB_SHA`, which GitHub Actions sets for every step and
which the build declares in its Turbo task hash. This keeps commit-pinned
generated URLs correct when an earlier `.turbo` directory is restored.

## Cloudflare configuration

The docs deployment needs these repository values:

- Secret `CLOUDFLARE_API_TOKEN`
- Secret `CLOUDFLARE_ACCOUNT_ID`
- Variable `CF_BEACON_TOKEN` — the production line's Web Analytics site token
- Variable `CF_BEACON_TOKEN_BETA` — the Pre-release Docs line's site token

The `GITHUB_TOKEN` Worker secret is configured separately for each Wrangler
environment with `wrangler secret put GITHUB_TOKEN`.

## Zotero release host

The release workflow expects a permanent prerelease named `zotero-release`.
Create it once with `update.json` and `update-beta.json` assets. The workflow
downloads those files before it updates a release channel, and a missing host
fails the release before it publishes a new Zotero add-on.

## Verification

For a CI cache change:

1. Run a clean docs build.
2. Run the same build again and confirm Turbo reports cache hits.
3. Confirm a changed `GITHUB_SHA` gives `@zotlit/docs#build` a different hash.
4. Record the GitHub Actions durations for checkout, setup, install, build, and
   the complete job before and after the change.

Hosted-runner durations are diagnostic data. They are not a fixed CI pass or
fail threshold.
