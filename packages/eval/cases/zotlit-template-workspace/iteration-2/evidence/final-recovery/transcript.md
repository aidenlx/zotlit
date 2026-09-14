# Final bundle retained-attempt recovery

Operator probe on 2026-09-13. Bundle source: `c37419836`. The retained
attempt timestamp is `2026-09-13T14:08:50.140215088Z`. This verifies the
final review fix; it is not a new Luna trial.

The operator built and reloaded the plugin with:

```sh
pnpm --filter @zotlit/obsidian build:dev
obsidian vault=bd0ea1a22beb8f55 plugin:reload id=zotlit
```

The following are the operator's recorded command strings. Original output
paths remain in the commands as historical locations. Complete JSON responses
are committed alongside this transcript.

## Initial check

```sh
obsidian vault=bd0ea1a22beb8f55 zotlit:template-check profile=Books key=BBBB2222 expect-source=8a19f09e > /private/tmp/zotlit-1086-final-recovery-check.json
```

[check.json](check.json) returns `ok=true`, Contract 7, Books Profile
`V1StGXR8Z5jd`, source `8a19f09e`, and current Profile, Citation Template,
and Shared Partial revisions. All eight component checks pass.

The operator extracted the attempt ID with Python and stored it in `rec`:
`9d2a2e2e-9d56-4578-aa8f-ef187ad1373c`. The extraction script itself was
not retained.

## Invalid retained lookup

```sh
obsidian vault=bd0ea1a22beb8f55 zotlit:template-check attempt="$rec" evidence=full output=all expect-source=8a19f09e > /private/tmp/zotlit-1086-final-recovery-invalid.json
```

[invalid.json](invalid.json) returns `ok=false`, `INVALID_SELECTOR`, and
the new recovery hint:

> Keep the same vault prefix. Use only attempt, output, and evidence for a retained lookup; omit expect-source and all input selectors. Example: zotlit:template-check attempt=<id> evidence=full output=all. The retained result carries the original source identity.

## Corrected retained lookup

```sh
obsidian vault=bd0ea1a22beb8f55 zotlit:template-check attempt="$rec" evidence=full output=all > /private/tmp/zotlit-1086-final-recovery-success.json
```

[success.json](success.json) returns `ok=true`, the same attempt ID and
source identity, `freshness.state=current`, all eight component checks
passed, and complete filename, properties, fold, frontmatter, body, managed,
and annotation outputs. Requested, disk, and loaded source revisions match.
The returned filename is `books-duplicateWithin2020`; the body starts with
`# Book profile: Within-library duplicate, first item`.

## Scope

These saved-source and retained-result checks do not install a draft or write
a Literature Note. This probe does not include a new Vault Case reset or
independent before/after vault snapshot. It verifies the omission hint and
successful recovery on the final bundle. No timing, token, or runtime
tool-call measurements were retained. Luna benchmark totals remain unchanged.
