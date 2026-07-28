# Spec: JSON language packs for the Obsidian plugin

Status: ready-for-agent
Date: 2026-07-28
Supersedes: DRAFT.md (all seven of its Open Decisions are resolved here)

## Problem Statement

ZotLit's Obsidian plugin ships only English text. A user whose Obsidian runs in
Simplified Chinese sees every ZotLit command, setting, notice, and view in
English. Bundling every translation into the plugin would grow `main.js` for
all users to carry locales they never use, while shipping translations as
remote JavaScript is prohibited for community plugins. Meanwhile the docs
website is about to share the same localization source, and docs-only strings
must not ride along inside the plugin.

## Solution

English stays bundled, so the plugin works fully offline out of the box. Every
other locale — starting with `zh-CN` — is compiled into a pure-data JSON
Language Pack published on a single rolling GitHub release of the plugin repo.
When Obsidian's language matches an available pack, the plugin offers to
install it; nothing is downloaded without explicit consent. An installed pack
is validated as data, cached on the device, and applied after an Obsidian
restart. Any missing, stale, invalid, or unavailable pack degrades to English
— per message when the pack is partial, wholesale when it is unusable.

## User Stories

1. As an English-speaking user, I want all plugin text bundled with the plugin, so that ZotLit works completely offline with no extra download.
2. As a user running Obsidian in Simplified Chinese, I want ZotLit to offer its `zh-CN` Language Pack, so that I can use the plugin in my language.
3. As a user, I want the plugin to make no network request until I explicitly agree to install a Language Pack, so that I control what the plugin fetches.
4. As a user who declined the install prompt, I want the plugin to never auto-prompt me again, so that my choice is respected.
5. As a user who declined earlier, I want a settings item that installs the Language Pack on demand, so that I can change my mind later.
6. As a user who installed a Language Pack, I want it cached on my device, so that later startups need no network access.
7. As a user who just installed a Language Pack, I want a clear notice that an Obsidian restart applies it, so that I know why the UI is still English.
8. As a user updating the plugin, I want my installed Language Pack refreshed automatically without being asked again, so that translations keep pace with new strings.
9. As a user whose freshly updated plugin has not yet fetched the matching pack, I want the session to run in English rather than show broken or mixed-version strings.
10. As a user who is offline when a pack is stale or missing, I want the plugin to load normally in English, so that translation delivery never blocks plugin startup.
11. As a user of a partially translated locale, I want untranslated messages to appear in English individually, so that one missing string never disables the rest.
12. As a user whose Obsidian language has no Language Pack, I want the plugin to run in English without prompts or errors.
13. As a user who downgrades the plugin, I want a newer cached or fetched pack to degrade gracefully per message, so that a version mismatch never breaks the UI.
14. As a multi-device user, I want pack installation to be per-device and invisible to vault sync, so that language data never churns my synced vault.
15. As a privacy-conscious user, I want the README to state exactly what is downloaded and from where, and the install prompt to state that a Language Pack is downloaded, so that the network behavior is transparent.
16. As a community-plugin reviewer, I want the localization path free of `eval`, `new Function`, and remote code, and every remote artifact validated as data, so that the plugin passes review.
17. As a maintainer, I want Language Packs published by the existing release workflow with the built-in `GITHUB_TOKEN` only, so that no new secrets or pipelines exist.
18. As a maintainer, I want republishing byte-identical packs to be harmless and idempotent, so that release automation needs no diff bookkeeping to stay correct.
19. As a translator, I want to author translations in the existing Inlang message format and project, so that current tooling and workflow keep working.
20. As a docs-site maintainer, I want docs-only messages excluded from the plugin's bundled and remote artifacts, so that plugin users never pay for website strings.
21. As a plugin developer, I want existing `m.*` call sites to keep their generated key and input types unchanged, so that the migration touches imports, not call code.
22. As a plugin developer, I want message edits to regenerate types and the English pack in watch mode without rebuild loops, so that the inner loop stays fast.
23. As a plugin developer, I want typecheck and tests to see generated output before any build runs, so that fresh clones and CI order themselves correctly.
24. As a maintainer, I want `main.js` to carry only English content plus a small interpreter, so that adding locales never grows the bundle.
25. As a translator, I want each build to report which plugin messages a locale still lacks, so that I can see what needs a string without the build failing.
26. As a user with no pack to install — English, an unsupported locale, or a pack already running — I want no Language Pack item in settings, so that the tab carries only actionable controls.
27. As a user whose plugin build is older than the published pack schema, I want a failed install to tell me to update ZotLit, so that I know the fix instead of retrying a doomed download.

## Implementation Decisions

### Source of truth and scoping

- The root Inlang project and `messages/{locale}.json` remain the single
  localization source of truth, shared with the future docs-site i18n. The
  project configuration stays valid for other Inlang consumers; the plugin's
  compiler reads it through `@inlang/sdk` (dev dependency) without forking it.
- Message keys prefixed `docs_` are docs-only; the plugin compiler excludes
  them from the wrapper facade, the bundled English pack, and remote packs.
  Unprefixed keys are plugin messages, reusable by the docs site.
- `zh-CN` is added to the Inlang locales with `messages/zh-CN.json`. Inlang
  plugin module versions are pinned (not `@latest`) for reproducible builds.
- This is a standalone implementation on this branch. The `feat/i18n` worktree
  is an experiment branch used as reference for build integration only; none
  of its runtime (ICU, `use-intl`), message layout, or ADRs apply here.

### Build-time compiler

- A ZotLit-owned generator loads the Inlang project once per build and emits,
  from a single entry point: a typed message-wrapper facade (one export per
  bundle, deriving each input's name and type from the base locale — see
  Message Input contract), the
  bundled English pack, and one remote pack JSON per non-English locale.
- The compiler — never the runtime — normalizes the Inlang SDK AST into the
  pack schema. Unstable SDK UUIDs are stripped; output is deterministic for
  identical normalized input.
- Input-free single-text messages compile to plain strings (fast path).
  Structured messages use descriptive JSON nodes, not tuple encoding.
- Markup, unknown declarations, unknown expressions, and unknown formatters
  are rejected at generation time with a positioned error. So are a bundle ID
  or input name that is not a TypeScript identifier, which would otherwise
  emit an uncompilable facade.
- The compiler reports, per non-base locale, the plugin bundles the base
  locale defines but that locale omits. It is a report, never a rejection —
  partial packs are by design and the runtime falls back per message. The
  scan runs over the same plugin-only bundle set the packs are built from, so
  `docs_` bundles stay out of it, and the base locale is excluded from the
  report. Surfaced as a build warning: the CLI writes it to stderr, the Vite
  plugin emits it via `this.warn`. Bringing `messages/zh-CN.json` to full
  parity with `messages/en.json` cleared the initial report.
- The generator lives in the Obsidian package (no new workspace package) and
  is invoked by an in-config Vite plugin following the reference branch's
  pattern: regenerate during `buildStart`, watch the message files, the
  project settings, and the generator itself, exclude the generated file from
  the watcher, and skip identical rewrites so watchers stay quiet.
- Turbo wiring follows the same reference pattern: a generate task that
  `typecheck`, `typecheck:test`, and `test` depend on; `build` widens its
  cache inputs to the message files instead of depending on the task. The
  generated facade is gitignored build output. `paraglide:compile` is replaced
  by the new generate task; `@inlang/paraglide-js` is removed once imports
  have migrated off the Paraglide-generated modules.

### Message Input contract

- The base locale alone determines which inputs a Message takes and what type
  each one has. A non-base locale that narrows a type is ignored: the
  interpreter coerces (`Number(argument)`), so a locale-only `:number` still
  formats a string the caller passed.
- Inputs are typed `string | number`. An input the compiler sees as a
  `datetime` argument also admits `Temporal.Instant` and `Temporal.PlainDate`,
  whose `toString()` is the ISO 8601 the interpreter already parses; `Date` is
  excluded per the temporal-dates policy. The facade imports `Temporal` as a
  type only when some input infers a date type.
- Narrowing is best-effort, read from base-locale usage: the sole argument of
  `plural` or `number` is a `number`, a selector whose every literal match
  parses as a number is a `number`, a `datetime` argument takes the widened
  date type, and anything else keeps the floor. An input used two ways within
  the base locale widens back to the floor.
- A non-base Message referencing an input the base locale does not declare is
  omitted from that locale's pack and falls back to English per message. It is
  reported once, in its own build warning naming the locale, bundle, and
  input — never a build failure, and never repeated in the untranslated
  report. A locale defining its own `local` declarations is unaffected, since
  a local never reaches a call site.
- A bundle with no base-locale Message is omitted from the facade and from
  every pack, with a warning. A call site referencing it then fails typecheck
  where the call is, instead of rendering the raw bundle ID to English users.
- Declarations reach the compiler unioned across locales with only their name
  to identify them, so two locales declaring one name differently leave the
  bundle ambiguous: both survive the union and both would land in every pack,
  where the later one wins at render time. This is the one drift the compiler
  rejects with a positioned error rather than reporting, because every way of
  resolving it silently picks one locale's formatter to run against another
  locale's message. Identical declarations dedupe upstream, so only a genuine
  conflict trips it.

### Language Pack data contract

Shape settled during drafting (trimmed; from the DRAFT's measured prototype —
the full English set is ~8 KB gzipped):

```json
{
  "schemaVersion": 1,
  "locale": "zh-CN",
  "messages": {
    "welcome_view_name": "欢迎使用 ZotLit",
    "annot_view_filter_count": {
      "declarations": [{ "type": "input", "name": "shown" }],
      "variants": [
        { "matches": [], "pattern": [{ "type": "variable", "name": "shown" }] }
      ]
    }
  }
}
```

- No `sourceHash`, no digest, and no embedded plugin version: compatibility is
  positional (see Distribution), and identical content must stay
  byte-identical across releases so republishing is idempotent.
- A pack may be partial; it never copies English strings.
- Each Message carries only the declarations its own variants reference, so a
  translation without placeholders compiles to a plain string even when the
  base Message takes inputs, and no pack carries another locale's inputs.
- Validation before install: `schemaVersion` match, `locale` match, structural
  validation of every node, and caps on total size, message count, text
  length, nesting depth, and formatter names. HTTPS provides transport
  integrity; there is no hash or signature layer.
- A `schemaVersion` mismatch throws a distinguishable
  `LanguagePackSchemaVersionError` carrying `updateNeeded` — true exactly
  when the pack declares a numeric schema version higher than the constant
  this build reads (`LANGUAGE_PACK_SCHEMA_VERSION`, currently 1). When a
  download fails that way, the install toast tells the user to update ZotLit
  instead of the generic download-failure notice; any other mismatch (older,
  or non-numeric) stays a plain rejection with no user-actionable advice.
  This is the download path only: a cached pack from a newer lineage is
  unreachable because the cache key is scoped by plugin version, so the cache
  path keeps discarding invalid packs silently.

### Runtime interpreter

- The runtime owns at most one installed pack plus the bundled English pack
  and exposes synchronous translation to the generated wrappers. It supports
  plain text, input interpolation, literal and catch-all variant matching in
  source order, local declarations in declaration order, and an allowlisted
  formatter registry matching Paraglide semantics: `plural`
  (`Intl.PluralRules`), `number` (`Intl.NumberFormat`), `datetime`
  (`Intl.DateTimeFormat`).
- Fallback ladder: active pack → English per message → bundle ID. Both render
  paths are guarded: an active-pack message that throws falls through to
  English, and English that throws returns the bundle ID with a warning.
  Unsupplied inputs carry no runtime guard — the generated types are the guard.
- No `eval`, `new Function`, or dynamic import anywhere in the path.

### Locale resolution

- Canonical locales use Inlang naming (`zh-CN`). A hand-maintained Locale
  Alias table maps Obsidian language codes to canonical locales — initially
  `zh → zh-CN` (Obsidian emits `zh`/`zh-TW`, never `zh-CN`). Unmatched codes
  resolve to English.

### Install and consent lifecycle

- Startup never blocks on the network. During plugin load: resolve the locale;
  English installs the bundled pack; a supported non-English locale checks the
  device cache synchronously and installs a valid cached pack.
- With no cached pack, the plugin shows a consent notice offering the install
  (naming the locale only). Decline dismisses permanently — the settings
  item becomes the only entry point. Accept downloads, validates, caches, and
  raises a "restart Obsidian to apply" notice.
- The Language Pack setting item is shown only while a pack ships for the
  resolved locale and that pack is not already installed and active: English
  (and any locale with no pack) never sees it, a user running a cached,
  applied pack never sees it, and it appears only to offer an install or to
  report that a downloaded pack awaits a restart. Its install action is
  additionally withheld while a consented background refresh is already
  downloading the same pack, so the button cannot start a second download.
  The rule and the copy live in one place (`languagePackSettingCopy`, which
  returns `undefined` when the item is hidden); both the declarative (1.13+)
  and imperative (compat) tabs consume it.
- The installed language is session-stable; packs cached mid-session apply on
  the next launch.
- After a plugin update, the versioned cache key misses; consent persists, so
  the pack re-downloads automatically in the background, followed by the
  restart notice. The interim session runs English.
- Cache lives in Obsidian's device-scoped local storage (per the local-storage
  policy), keyed by plugin version and locale, so staleness detection is a
  cache miss rather than a version comparison.

### Distribution and versioning

- All Language Packs are published as assets of one rolling GitHub release of
  the plugin repo (dedicated fixed tag), with fixed filenames per locale
  (`zh-CN.json` is always the latest). The release workflow clobber-uploads
  them on each plugin release using the built-in `GITHUB_TOKEN` — mirroring
  the Zotero side's rolling `update.json` precedent.
- There is no pack version pointer: no manifest field, no committed state
  file, no catalog artifact. The plugin version is the pack lineage; a plugin
  update triggers exactly one refetch per device. Skipping uploads when packs
  are unchanged is an optional workflow optimization, not a correctness
  requirement.
- Download URLs are fixed HTTPS release-asset URLs, fetchable anonymously
  (no GitHub API, no rate-limit token).

### Local dev server (opt-in)

- For testing multi-language i18n, `I18N_DEV_SERVER=true` (or a port number;
  default 9092) on the dev watch build starts a local HTTP server that serves
  the generated pack JSONs (`zh-CN.json`) straight from the generated output
  directory, and the build inlines that server's URL and origin as the pack
  download target via Vite defines. Production builds always target the GitHub
  release-asset URLs; the logs disclose whichever origin the build inlined.

### Disclosure

- The plugin README's "Network use" paragraph is the one place naming the
  artifact and origin exactly. The consent notice and the settings item
  description state only that a Language Pack is available for / downloaded
  for the locale — never the file or the host; those appear only in logs.
  Story 15's transparency is therefore carried by the README alone, with the
  prompt stating only that a pack is downloaded. No further review research
  is planned.

## Testing Decisions

A good test drives external behavior through a seam and asserts observable
output — never interpreter internals, cache formats, or generated-code text.
Two seams (confirmed with the developer):

1. **Compiler seam** — the generator entry point: Inlang project files in,
   emitted artifacts out. Tests run it against the real project and small
   fixture projects, asserting: one wrapper per bundle with preserved input
   names, deterministic output, stripped SDK IDs, plain-string fast path,
   partial packs without English copies, positioned rejection of markup
   and unknown constructs, the input-drift and missing-base-locale drops with
   their warnings, the untranslated-message report with its base-locale
   exclusion, and the `updateNeeded` classification of schema-version
   rejections. Inferred input types are asserted with `expectTypeOf` against
   the real generated facade, keeping the assertion on the type rather than on
   the text of the generated code. Prior art: the reference branch runs
   generator tests from the package's scripts directory under Vitest.
2. **Runtime seam** — the i18n subsystem's boundary to Obsidian, an injected
   port bundle: language code, device storage (the existing `DeviceStorage`
   pick), an HTTP port shaped like `requestUrl`, and consent/notice signals
   returned as data per the ui-seams policy. Tests initialize with fake ports
   and assert through public wrapper calls and returned data: alias
   resolution, cache hit and miss by plugin version, consent accept/decline
   persistence, validation rejection (schema, locale, structure, caps),
   offline fallback, per-message and bundle-ID fallback, interpolation,
   variants, and formatter behavior, plus the setting item's visibility
   across the no-pack/cached/installed states, its withheld install action
   during a consented refresh, and its copy. Prior art: the device-paths
   storage fakes and the Obsidian mock's `getLanguage()` stub.

A **temporary parity gate** composes both seams during migration: compile the
real project and compare interpreter output against the current
Paraglide-generated functions — byte-for-byte for all input-free English
messages, fixture-driven for the 60 input-bearing messages, explicit coverage
of the multi-variant `creator_summary`. The gate is deleted once parity holds;
the seam tests remain the maintained contract.

## Out of Scope

- Docs-site i18n implementation (only the shared-source and `docs_`-prefix
  contract is fixed here).
- Locales beyond `zh-CN` (the structure supports them; no other pack ships).
- Live language switching without restart.
- Markup messages and a `.parts()`-style API (rejected at build until a
  concrete caller exists).
- Hash/digest pinning, signed catalogs, or translation updates decoupled from
  plugin releases.
- Mobile (the plugin is desktop-only).

## Further Notes

- Bundle-size motivation: the measured English pack is ~41.8 KB JSON / ~7.9 KB
  gzipped; non-English content stays out of `main.js` permanently.
- Domain vocabulary (Message, Language Pack, Locale Alias) is recorded in the
  Obsidian context glossary; "language" unqualified remains reserved for
  template languages.
- The DRAFT in this directory retains the full exploration record, Paraglide
  boundary analysis, and alternatives considered; where the two disagree
  (sourceHash, sha256, bounded startup wait, pinned catalog), this spec wins.
- The central trade-off (custom data-pack compiler + interpreter replacing
  the Paraglide runtime, standalone from the `feat/i18n` experiment) is
  recorded as ADR 0012. Tickets live in `tickets.md` in this directory.
- Open follow-on question tracked in `TODO.md` in this directory.
