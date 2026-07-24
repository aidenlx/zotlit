# Stable ships from main, betas ship from next

ZotLit releases two lockstep apps (the Obsidian plugin and the Zotero companion) through two distribution channels: stable (community plugin store / `update.json`) and beta (BRAT / `update-beta.json`). Development happens on `next`, the beta line; fixes that stable users need — security patches, regressions — are cherry-picked to `main` and released as `2.0.x` patches. This dual-branch model, introduced with the unified release pipeline and documented in `CONTRIBUTING.md`, stays in force when 2.0.0 graduates to GA: `main` is the patch-only stable line receiving cherry-picks, `next` is the beta line kept strictly ahead. `release.yml` triggers on pushes to both branches and derives the release channel from the semver prerelease component, so the branch model requires no CI awareness beyond the trigger list.

## Considered Options

- **Trunk-only with hotfix branches cut from the last stable tag on demand** (rejected): there is no standing stable line to cherry-pick onto, so every stable patch starts by reconstructing one; `release.yml` would need new `hotfix/**` triggers; and the standing beta channel — which ZotLit's users actually track via BRAT and `update-beta.json` — loses its home between releases.
- **Collapse `next` into `main` after GA and release betas from the trunk** (rejected): beta work and stable patches interleave on one branch, so a stable `2.0.x` release can only ship by reverting or gating everything unfinished ahead of it. The cherry-pick flow that motivates the model becomes impossible.
- **Keep dual `main`/`next`** (chosen): the pipeline, `release.ts` branch awareness, and `CONTRIBUTING.md` are already built around it, and it is the only shape that supports "dev on beta, cherry-pick to stable."

## Consequences

- `main` and `next` diverge permanently between graduations. Graduation reconciles them: ship the beta's version from `main`, then rebase `next` onto the next prerelease.
- The "beta strictly ahead of stable" invariant is convention-only — nothing in `release.ts` or CI compares the bumped version against the other branch. A stable bump that overtakes the beta line breaks channel ordering silently.
- A security patch touching both apps (e.g. the protocol) is cherry-picked to `main` for both, with both apps patch-bumped in a single release PR, preserving the lockstep pairing on the stable channel.
- The model is active only while a beta line exists. Between beta cycles `next` goes dormant and all work — including the next minor — ships from `main`; `next` is revived (rebased onto `main`, bumped to the next prerelease) when a public beta is warranted again.
- Root `manifest.json` / `versions.json` are regenerated only by stable releases, so they live on `main` and always describe the latest stable — the community plugin store reads them from there.
