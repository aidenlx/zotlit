# Obsidian guideline review runs on ESLint at release

Obsidian publishes its plugin developer guidelines as `eslint-plugin-obsidianmd`
and nothing else. oxlint has no equivalent for checks like "this API needs a
newer `minAppVersion`", "detaching leaves in `onunload` leaks", or "this
`manifest.json` field is malformed" — the rules encode Obsidian's review
process, not general TypeScript hygiene. So the repo carries a second linter for
that one purpose. oxlint + oxfmt remain the routine toolchain; ESLint runs only
when a release is being cut.

Release-scoped is a deliberate scope, not a performance concession. These rules
move with Obsidian's review process rather than with our code, so a violation
appears when *they* change, not when *we* commit — which makes per-PR runs
mostly noise, and makes the moment before submission the moment that matters.
`release.ts` gates locally before the release branch exists, and
`plugin-review.yml` re-runs it on `release/**` PRs as the backstop that cannot
be skipped. `release.yml` was rejected as the gate: it only fires after merge,
when the version commit has already landed.

Only the 39 `obsidianmd/*` rules are enabled. The plugin's `recommended` config
bundles 176 more — `js.configs.recommended`, typescript-eslint's
`recommendedTypeChecked`, `import`, `eslint-comments`, `depend`,
`no-unsanitized`, `@microsoft/sdl` — and all of that is oxlint's job here.
oxlint runs with `typeAware`/`typeCheck` enabled, implements 59 of 61 type-aware
typescript-eslint rules, and carries deliberate tuning that the second copy
would re-litigate: the repo sets `typescript/no-explicit-any` off, and ESLint's
copy of that rule reported ten violations on its first run. Two linters
disagreeing about the same code is worse than one linter with a narrower job.

The awkward part is TypeScript. typescript-eslint needs the classic JS compiler
API, and TypeScript 7 — the Go-native port the repo builds with — ships no API
at all; typescript-eslint checks `versionMajorMinor >= 7` and throws. Six of the
`obsidianmd` rules are type-aware, including `no-unsupported-api`, the most
valuable one, so dropping type information was not an option. The root
`package.json` therefore aliases `typescript` to `@typescript/typescript6`,
which is Microsoft's own documented recipe for exactly this case, while every
workspace package keeps `typescript` at 7 through the catalog. pnpm's isolated
`node_modules` is what makes the two coexist. **This is temporary**: Microsoft
has stated TypeScript 7.1 will ship a new API, and this alias should be deleted
once typescript-eslint supports it.

## Considered Options

- **Skip the scan; rely on Obsidian's submission review** — no second linter, no
  aliased TypeScript, and violations are found by a human reviewer after
  submission, when the fix costs a new release rather than a commit.
- **Run it on every PR alongside oxlint** — catches violations earliest, at the
  cost of a full ESLint + type-aware pass on every PR for rules that change on
  Obsidian's schedule, plus two linters reporting on the same diff.
- **Put the ESLint stack in `apps/obsidian`** — the obvious home, and impossible:
  that package needs real TypeScript 7 for its own `tsc --noEmit`, and one
  package cannot resolve `typescript` to both 6 and 7.
- **Isolate it in a `packages/plugin-review` workspace** — cleaner blast radius
  for the TS 6 alias, at a whole workspace package for one config file, and the
  run still needs the repo root as cwd because the plugin reads `manifest.json`
  from `process.cwd()`.
- **Drop the type-aware rules and skip the alias entirely** — removes the
  TypeScript problem and with it `no-unsupported-api`, `prefer-create-el`, and
  four other rules, leaving the cheapest half of the check.
- **Keep the plugin's full `recommended` config** — maximum fidelity to
  upstream's intent, and 44 errors on the first run that had nothing to do with
  Obsidian's guidelines and everything to do with re-litigating oxlint's
  settings.
