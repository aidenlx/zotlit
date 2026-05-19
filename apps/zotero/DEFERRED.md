# Deferred work — @zotlit/zotero

Items deliberately out of scope of the scaffold step, with the trigger that should bring them in.

---

## Release process (version bump → tag → CI → `update.json`)

**Current**: no release pipeline exists. `vite build` produces the XPI locally; nothing is published, tagged, signed, or advertised to Zotero's auto-update channel.

**Planned**: an end-to-end release flow scoped to `apps/zotero`, independent of the Obsidian plugin's release cadence (despite sharing a monorepo version today). The full pipeline:

### 1. Version bump

- Source of truth: `apps/zotero/package.json#version`. The `manifest.json` `version` field is generated from it at build time by `scripts/manifest.ts` (already wired).
- Bump performed locally via a `pnpm --filter @zotlit/zotero release:bump <patch|minor|major|prerelease>` script (to add) that:
  - updates `apps/zotero/package.json`
  - regenerates `CHANGELOG.md` from conventional-commit history scoped to `apps/zotero/**` (tool TBD — `changesets` or `git-cliff`)
  - commits the bump + changelog on a branch and opens a PR (no direct push to `main`)
- Pre-1.0 / alpha-track bumps use `prerelease` semantics (`2.0.0-alpha.N`); stable releases drop the pre-release suffix.

### 2. Tagging

- Tag format: `zt{version}` (e.g. `zt2.0.0-alpha.1`, `zt2.0.0`). The `zt` prefix namespaces Zotero-companion tags away from any future Obsidian-plugin tag prefix.
- Tags are cut **only after** the release PR merges to `main`, by pushing the tag from the merge commit. Manual `git tag && git push --tags`, or a `release:tag` script that verifies HEAD matches the merged PR commit.

### 3. Release CI

A GitHub Actions workflow at `.github/workflows/zotero-release.yml`, triggered by `push: tags: ['zt*']`, that:

1. Checks out the tagged commit, restores pnpm cache, runs `pnpm install`.
2. `pnpm --filter @zotlit/zotero build` to produce the production XPI under `apps/zotero/dist/`.
3. Renames the artifact to `zotlit-zotero-{version}.xpi`.
4. Computes `sha512` of the XPI.
5. Creates a GitHub Release for the tag, body sourced from `CHANGELOG.md`, uploading the XPI as the sole release asset.
6. Regenerates `apps/zotero/update.json` (see schema below), committing the result back to `main` via a follow-up PR (or direct commit guarded by a PAT — TBD; PR is safer).

The workflow must be idempotent: re-running on the same tag must not duplicate releases or `update.json` entries.

### 4. `update.json` schema

Committed at `apps/zotero/update.json`, served via `https://raw.githubusercontent.com/aidenlx/zotlit/main/apps/zotero/update.json` (the URL `manifest.json#applications.zotero.update_url` points at):

```jsonc
{
  "addons": {
    "zotlit@aidenlx.top": {
      "updates": [
        {
          "version": "...",
          "update_link": "https://github.com/aidenlx/zotlit/releases/download/zt{version}/zotlit-zotero-{version}.xpi",
          "update_hash": "sha512:...",
          "applications": {
            "zotero": {
              "strict_min_version": "9.0",
              "strict_max_version": "9.*",
            },
          },
        },
      ],
    },
  },
}
```

The generator appends to `updates[]` rather than replacing — Zotero clients pick the highest matching `version`, so retaining history lets users on older Zotero majors keep receiving compatible patches. Pre-release versions (`-alpha.*`, `-beta.*`) live in the same array; client-side filtering (or a separate `update.json` per channel) is a later decision.

### 5. `manifest.json` wiring

When the first user-installable release ships, `apps/zotero/scripts/manifest.ts` must emit:

```jsonc
{
  "applications": {
    "zotero": {
      "id": "zotlit@aidenlx.top",
      "update_url": "https://raw.githubusercontent.com/aidenlx/zotlit/main/apps/zotero/update.json",
      "strict_min_version": "9.0",
    },
  },
}
```

This unlocks Zotero's in-app auto-update prompt. Until then, users install from a release asset URL manually.

### Open questions / TBD

- Signing: Zotero 9 add-on signing requirements (if any beyond `update_hash`) are not yet researched.
- Bot identity: whether the `update.json` commit-back uses a dedicated GitHub App, a PAT, or `GITHUB_TOKEN` with `contents: write` on a separate workflow.
- Changelog tool: `changesets` (better monorepo story, allows Obsidian + Zotero to share infra) vs `git-cliff` (lighter, conventional-commit native).
- Whether to keep a single `update.json` or split per Zotero major once a Zotero 10 ever appears.

**Trigger**: cutting the first user-installable release. Tracking issue should be filed before the alpha graduates to a tag users are expected to install.

---

## Prefs: graduate to prefix + `.d.ts` codegen

**Current**: `addon/prefs.js` has full `extensions.zotlit.*` keys; `src/prefs/index.ts` exposes a typed wrapper with a hand-maintained `PrefsMap`.

**Planned**: a build step that parses `addon/prefs.js`, prefixes unprefixed `pref("key", ...)` entries with `extensions.zotlit.`, prefixes `preference="..."` attributes in XHTML, and generates a `PluginPrefsMap` type for narrowing `Zotero.Prefs.get/set` project-wide.

**Trigger**: pref count crosses ~15.
