# Template contract artifacts generate from the TS types via a frozen TS 6 extractor

The `zt` template contract was described in three places — the hand-written TS
types in `packages/db/src/lib/context/`, the hand-maintained docs reference
tables, and (planned) the Template Workbench's JSON Schema — and they already
disagreed (`zt.citation` documented but untyped; the annotation `type` enum
closed in docs, open in code). We decided the TS types plus their JSDoc are the
single source of truth: a ts-morph extractor emits a committed contract IR, and
emitters generate the JSON Schema (per-item-type branches from
`zotero-schema/schema.json`), the docs reference page, and the artifacts the
Workbench CLI serves. A CI check verifies regeneration is clean, so the copies
cannot drift.

The extractor's parser is deliberately **not** the repo's TypeScript. The
catalog pins TypeScript 7 (the native Go port), which ships no programmatic API
until 7.1; ts-morph vendors its own frozen classic TypeScript 6.0.2, and that
vendored copy is the effective parser. Do not add a `typescript` dependency to
"align" the versions — it would be a no-op. Both compilers were verified to
check `packages/db` identically, and TS 6's maintenance freeze is a stability
property for committed-output codegen: a syntax gap fails loudly as a parse
error in the CI regeneration check, never as silently wrong output.

## Considered options

- **ts-json-schema-generator (schema-as-IR)** — maintained and capable, but a
  JSON Schema cannot carry what the docs emitter needs (per-template
  availability, helper filter hints, anchors), and replacing the open item-field
  index signature is cleanest in an IR we own.
- **TypeScript 7 `./unstable` API** — works today, but 7.1 ships a new and
  different API, so adopting it buys a guaranteed rewrite to avoid a
  low-probability one.
- **valibot schema-first** — inverts the whole `packages/db` context-type layer
  for no added fidelity.
- **TypeDoc `--json`** — docs-capable, schema-hostile, version-drifting model.

## Exit triggers

Migrate off the frozen parser when any one fires: the CI regeneration check
fails with a parse error (not a diff); ts-morph ships TypeScript 7 support
(then it is a version bump); or TS 7.1's stable API becomes necessary for
richer type resolution. If forced before ts-morph is ready, repoint the same
extraction at the built `dist/**/*.d.mts` declarations — tsdown preserves JSDoc
there, and declaration-file grammar moves far more slowly than full TypeScript.
