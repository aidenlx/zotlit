# Draft: JSON language packs for the Obsidian plugin

Status: needs-triage
Date: 2026-07-27

## Objective

Keep `project.inlang/` and `messages/{locale}.json` as ZotLit's localization
source of truth while giving the Obsidian plugin an eval-free runtime:

- English is bundled with the plugin.
- Other locales, beginning with `zh-CN`, are delivered as remote JSON language
  packs.
- Every remote artifact is parsed and validated as data.
- Existing synchronous `m.*` call sites retain generated key and input types.
- A missing, stale, unavailable, or invalid pack falls back to English.

## Verified Current State

- The shared project is configured in `project.inlang/settings.json`; it
  currently declares only `en`.
- The Obsidian build runs `paraglideVitePlugin()` from
  `apps/obsidian/vite.config.ts` and generates `apps/obsidian/src/paraglide/`.
- `apps/obsidian/src/lib/i18n.ts` connects Paraglide to Obsidian's
  `getLanguage()`.
- `apps/obsidian/src/zt-main.ts` initializes i18n before any service can call a
  message function.
- Application code imports `m.*` message functions extensively, but it does
  not use Paraglide's `.parts()`, per-call locale override, or
  `LocalizedString` type outside generated code.
- Loading the project through `@inlang/sdk` and
  `selectBundleNested(project.db)` produced:
  - 435 bundles.
  - 60 bundles with input variables.
  - 1 bundle with multiple variants.
  - 0 bundles with markup.
  - 0 bundles with local formatter variables.
- A compact normalized pack for the current English messages was approximately
  41.8 KB as JSON and 7.9 KB with gzip. The source `messages/en.json` is
  approximately 29.8 KB.

## Paraglide Boundary

Paraglide is a compiler-first library that turns Inlang's normalized
bundle/message/variant AST into JavaScript functions. Its useful boundary for
ZotLit is before JavaScript emission:

- `@inlang/sdk` loads `project.inlang/`.
- `selectBundleNested()` exposes declarations, locale messages, variants,
  matches, and patterns as structured data.
- Paraglide's compiler then emits executable locale modules and a routing/SSR
  runtime.

ZotLit can consume the SDK AST at build time and replace Paraglide's emitted
runtime with a compact JSON program plus an interpreter. Relevant upstream
source:

- `/Users/aidenlx/repo/paraglide-js/src/compiler/compile-project.ts`
- `/Users/aidenlx/repo/paraglide-js/src/compiler/compile-bundle.ts`
- `/Users/aidenlx/repo/paraglide-js/src/compiler/compile-message.ts`
- `/Users/aidenlx/repo/paraglide-js/src/compiler/compile-pattern.ts`
- `/Users/aidenlx/repo/paraglide-js/src/compiler/compile-local-variable.ts`
- `/Users/aidenlx/repo/paraglide-js/src/compiler/registry.ts`

## Proposed Architecture

### Build-time compiler

Add a ZotLit-owned compiler that uses `@inlang/sdk` as a development
dependency. It loads the shared Inlang project once and emits:

1. **Generated message wrappers**

   One named export per bundle, preserving the current call shape:

   ```ts
   export const greeting = (inputs: { name: NonNullable<unknown> }) =>
     translate("greeting", inputs);
   ```

   The wrapper generator derives required input property names from the base
   bundle declarations. Existing imports move from `@/paraglide/messages` to
   `@/i18n/messages`; message calls stay unchanged.

2. **Bundled English pack**

   A compact normalized JSON representation imported by the plugin bundle.
   Plain, input-free messages use string values as the fast path. Messages with
   interpolation, declarations, or variants use structured data.

3. **Remote locale packs**

   One JSON artifact per non-English locale. `zh-CN` is the first target.
   These artifacts are published separately from the Obsidian plugin ZIP and
   are absent from `main.js`.

4. **Bundled pack catalog**

   A small generated catalog pins the accepted remote artifact for each locale:

   ```json
   {
     "schemaVersion": 1,
     "sourceHash": "<hash of the normalized base message set>",
     "packs": {
       "zh-CN": {
         "url": "https://<fixed-origin>/<release>/zh-CN.json",
         "sha256": "<expected artifact digest>"
       }
     }
   }
   ```

   The catalog contains metadata only; English is the only bundled language
   content.

### Runtime interpreter

The runtime owns one installed locale pack and exposes synchronous
`translate(bundleId, inputs)` calls. It supports:

- Plain text.
- Input-variable interpolation.
- Literal and catch-all variant matching in source order.
- Local declarations evaluated in declaration order.
- An allowlisted formatter registry matching Paraglide:
  - `plural` via `Intl.PluralRules`.
  - `number` via `Intl.NumberFormat`.
  - `datetime` via `Intl.DateTimeFormat`.
- Per-message English fallback when a locale pack omits a translation.
- Bundle-ID fallback when neither the active pack nor English contains a
  message.

The first implementation can reject markup during generation with a positioned
build error. ZotLit currently has no markup messages and no `.parts()` callers.
Markup support can be added as a data-parts API when a concrete caller exists.

### Startup lifecycle

`Plugin.onload()` already provides the required asynchronous seam. Language
selection completes before services and actions register user-facing strings:

1. Read Obsidian's locale with `getLanguage()`.
2. Canonicalize it and resolve any explicit aliases from the bundled catalog.
3. For English, install the bundled pack.
4. For a supported non-English locale, synchronously inspect the versioned
   cache through `app.loadLocalStorage()`.
5. Validate and install a compatible cached pack when present.
6. Otherwise fetch the pinned URL with `requestUrl()` and a bounded startup
   wait.
7. Verify the JSON schema, locale, source hash, and SHA-256 before installation.
8. Cache a verified pack through `app.saveLocalStorage()`.
9. Install English for this session when loading does not complete
   successfully.

If a first download finishes after the startup deadline, cache it for the next
plugin load. Keep the session's installed locale stable: existing command
names, settings definitions, notices, and mounted views are not uniformly
reactive to a live language change.

Suggested cache key:

```text
zotlit:i18n:<sourceHash>:<locale>:<sha256>
```

## Language-Pack Data Contract

The emitted format should be compact and explicitly versioned. A representative
shape:

```json
{
  "schemaVersion": 1,
  "locale": "zh-CN",
  "sourceHash": "<base-source-hash>",
  "messages": {
    "welcome_view_name": "欢迎使用 ZotLit",
    "annot_view_filter_count": {
      "declarations": [
        { "type": "input", "name": "shown" },
        { "type": "input", "name": "total" }
      ],
      "variants": [
        {
          "matches": [],
          "pattern": [
            ["variable", "shown"],
            ["text", " / "],
            ["variable", "total"]
          ]
        }
      ]
    }
  }
}
```

The build compiler, rather than the runtime, translates the full Inlang SDK AST
into this stable pack schema. Internal SDK IDs such as message and variant UUIDs
are omitted.

`sourceHash` covers the pack schema version and normalized base message set,
including keys, declarations, selectors, and English content. A non-English
pack may be partial but must target the same source hash. Partial packs fall
back to English per message.

## Security and Review Properties

The distributed plugin should contain:

- No Paraglide-generated remote locale modules.
- No `eval`, `new Function`, remote `import()`, or script injection in the
  localization path.
- A fixed HTTPS origin or fixed URLs generated into the release catalog.
- A digest pinned in the bundled catalog for every accepted pack.
- Structural validation before any value enters the active message registry.
- Limits for total pack size, message count, text length, nesting depth, and
  supported formatter names.

The pinned catalog makes each plugin release deterministic. Independent
translation updates can be explored later with a signed mutable catalog if
that operational capability becomes valuable.

## Build Integration

Target state for `apps/obsidian`:

- Replace `paraglideVitePlugin()` with the ZotLit compiler hook or a compiler
  task that runs before Vite and TypeScript.
- Replace `paraglide:compile` with `i18n:compile`.
- Make Turbo `build`, `test`, and typecheck dependencies run `i18n:compile`
  before consuming generated wrappers.
- Preserve watch behavior by watching:
  - `project.inlang/settings.json`
  - `messages/*.json`
- Add `@inlang/sdk` as an explicit development dependency.
- Remove `@inlang/paraglide-js` from `apps/obsidian` after generated imports
  have migrated.
- Add `zh-CN` to the Inlang locales list and add
  `messages/zh-CN.json`.
- Pin the Inlang plugin module versions in `project.inlang/settings.json` when
  touching the configuration, so generation is reproducible instead of
  resolving `@latest`.

## Validation Plan

### Compiler tests

- Load the real project and emit one wrapper for every bundle.
- Preserve required input names.
- Emit stable output for identical normalized input.
- Strip unstable SDK IDs.
- Produce the same source hash regardless of database UUID allocation.
- Emit plain strings for the input-free single-text fast path.
- Reject unknown declarations, expressions, formatters, and markup.
- Generate partial locale packs without copying English strings into them.

### Runtime tests

- Bundled English lookup.
- Remote `zh-CN` lookup.
- Interpolation.
- Literal selector and catch-all behavior.
- Plural, number, and datetime formatter parity with Paraglide.
- Per-message English fallback.
- Missing bundle-ID fallback.
- Invalid schema, locale, source hash, and digest rejection.
- Stale-cache rejection.
- Offline fallback.
- Bounded first-download behavior.

### Parity tests

Use the current generated Paraglide output as an oracle during migration:

- Compare all 375 current input-free messages byte-for-byte in English.
- Provide fixtures for the 60 input-bearing messages and compare output.
- Cover the current multi-variant `creator_summary` cases explicitly.
- Add formatter fixtures before enabling local formatter declarations in
  translation source.

After parity is established, remove Paraglide and keep the custom compiler and
runtime tests as the maintained contract.

## Alternatives Considered

### Paraglide locale modules

The `locale-modules` output structure groups messages by locale but emits
JavaScript. Remote loading would still deliver executable code.

### Paraglide experimental middleware locale splitting

The feature is designed for SSR/SSG: server middleware injects used message
functions into HTML. Obsidian has neither the server request boundary nor the
HTML injection lifecycle it expects.

### Runtime parsing of `messages/{locale}.json`

Fetching the source message-format JSON would require shipping or recreating
the Inlang Message Format parser in the plugin. Build-time normalization keeps
plugin runtime semantics small and stable.

### i18next or ICU runtime

Both can load JSON dynamically, but changing message formats would migrate the
authoring model and existing messages. The SDK-to-pack design preserves
`project.inlang`, the current message format, and Inlang tooling.

### Per-locale plugin builds

Separate plugin artifacts avoid remote code but lose dynamic locale loading
and complicate distribution.

## Open Decisions

1. Choose the fixed pack origin and release publishing mechanism.
2. Set the startup wait budget for a first-time non-English user.
3. Decide whether a completed background download should show a reload notice
   or remain silent until the next plugin load.
4. Define the initial explicit locale alias table, especially the relationship
   among Obsidian's Chinese locale codes and `zh-CN`.
5. Choose whether SHA-256 verification uses Web Crypto or an existing project
   utility.
6. Decide whether the first implementation emits full descriptive JSON nodes
   or a compact tuple encoding. The measured compact representation is already
   small enough that clarity may win.
7. Confirm the community-plugin review posture for remotely fetched,
   integrity-pinned translation JSON before release.

## Suggested Skills

- `codebase-design` — settle ownership among the build compiler, generated API,
  runtime interpreter, and pack loader before implementation.
- `paraglide-i18n` — preserve Inlang Message Format semantics and the existing
  authoring workflow.
- `tdd` — drive compiler/interpreter parity against the current generated
  Paraglide output.
- `implement` — execute the migration after the open decisions are resolved.
- `research` — verify current Obsidian review requirements for remote
  translation data and choose an authoritative hosting strategy.

## Follow-up Entry Points

Read these first:

- `project.inlang/settings.json`
- `messages/en.json`
- `apps/obsidian/AGENTS.md`
- `apps/obsidian/vite.config.ts`
- `apps/obsidian/src/lib/i18n.ts`
- `apps/obsidian/src/zt-main.ts`
- `apps/obsidian/src/paraglide/messages.js`
- `apps/obsidian/src/paraglide/runtime.js`
- `/Users/aidenlx/repo/paraglide-js/src/compiler/compile-project.ts`
- `/Users/aidenlx/repo/paraglide-js/src/compiler/compile-bundle.ts`
- `/Users/aidenlx/repo/paraglide-js/src/compiler/compile-message.ts`
- `/Users/aidenlx/repo/paraglide-js/src/compiler/compile-pattern.ts`
- `/Users/aidenlx/repo/paraglide-js/src/compiler/registry.ts`

## Comments

- 2026-07-27: Initial exploration captured. A throwaway prototype verified the
  lifecycle boundary: asynchronous pack selection can complete before service
  construction while all message calls remain synchronous afterward. It also
  verified atomic English fallback for missing, stale, and offline non-English
  pack cases. The prototype was deleted after recording its conclusion.
- 2026-07-27: Grilling session resolved all seven Open Decisions; the settled
  design is published as `SPEC.md` in this directory (ready-for-agent). Where
  this draft and the spec disagree — sourceHash, sha256 pinning, the bundled
  catalog, and the bounded startup wait are dropped; install is consent-based;
  packs live on a single rolling release keyed by plugin version — the spec
  wins. This draft remains as the exploration record.
