# Tickets: JSON language packs for the Obsidian plugin

Status: ready-for-agent

Eight slices implementing `SPEC.md` in this directory (see also
ADR 0012): bundle English, deliver other locales as consent-installed,
validated JSON Language Packs from a rolling GitHub release.

Work the **frontier**: any ticket whose blockers are all done. Tickets 4 and 7
can proceed in parallel with the 2 → 3 → 5 → 6 chain.

## 1. Compiler emits the English artifacts

**What to build:** A generate task that loads the Inlang project and emits the
typed message-wrapper facade and the bundled English pack, wired into the
build the way the `feat/i18n` reference branch does it (in-config Vite plugin
regenerating at build start, watch on the message sources, turbo edges for
typecheck/test) — running alongside the untouched Paraglide pipeline. Editing
a message in watch mode regenerates the artifacts without rebuild loops.

**Blocked by:** None — can start immediately.

- [x] One typed wrapper per non-`docs_` bundle, preserving required input names; `docs_`-prefixed keys appear in no emitted artifact
- [x] Input-free single-text messages emit plain strings; structured messages emit descriptive JSON nodes
- [x] Output is deterministic for identical input and contains no Inlang SDK UUIDs
- [x] Markup, unknown declarations, expressions, or formatters fail generation with a positioned error
- [x] Watch mode regenerates on message/config/generator edits without loops; identical content skips the rewrite so watchers stay quiet
- [x] Typecheck and tests see generated output through task dependencies (verified from a clean turbo cache)
- [x] The existing Paraglide pipeline still builds and runs unchanged

## 2. English renders through the new runtime

**What to build:** The eval-free interpreter behind the generated wrappers:
`m.*` calls return correct English from the bundled pack, proven at the
runtime seam with fake ports. Purely additive — the shipping plugin still runs
on Paraglide.

**Blocked by:** 1.

- [x] Wrapper calls resolve through the interpreter against the bundled English pack
- [x] Interpolation, literal and catch-all variant matching in source order, and local declarations in declaration order behave per Paraglide semantics
- [x] `plural`, `number`, and `datetime` formatters match Paraglide output via the corresponding `Intl` APIs
- [x] Fallback ladder holds: active pack → English per message → bundle ID
- [x] No `eval`, `new Function`, or dynamic import anywhere in the localization path

## 3. Migrate the plugin onto the new runtime and remove Paraglide

**What to build:** While both systems coexist, run the one-time parity gate;
then swap every call site to the new facade (export names preserved, so the
change is mechanical), initialize the new runtime at plugin load with Locale
Alias resolution (unmatched codes → English), and delete Paraglide, its
generated modules, its compile task, and the parity gate. The built plugin
behaves identically in English.

**Blocked by:** 2.

- [x] Parity gate passes: byte-for-byte on every input-free English message, fixtures for all 60 input-bearing messages, explicit coverage of the multi-variant `creator_summary`
- [x] All call sites import the new facade with call shapes unchanged
- [x] Plugin load installs the English pack after Locale Alias resolution (`zh → zh-CN` table present; unmatched → English)
- [x] Paraglide dependency, generated modules, old compile task, related skill/docs references, and the parity gate are removed
- [x] Build, lint, and tests are green; manual smoke of the built plugin shows unchanged English UI

## 4. `zh-CN` exists as a compiled remote pack

**What to build:** Add `zh-CN` to the Inlang locales with a translation file
in Inlang message format (the experiment branch's translation is source
material to convert), and have the build emit a `zh-CN.json` Language Pack
artifact that passes the full validation set — kept out of `main.js`.

**Blocked by:** 1.

- [x] `zh-CN` declared in the Inlang project with a translation file; Inlang module versions pinned
- [x] The build emits a `zh-CN` pack passing schema, locale, structural validation, and size/count/length/depth/formatter caps
- [x] The pack is partial-safe: untranslated messages are absent, never copied from English
- [x] Pack bytes are stable across rebuilds when translations are unchanged
- [x] `main.js` contains no `zh-CN` content; bundle size is unchanged apart from the interpreter

## 5. Consent-based install lifecycle

**What to build:** The full non-English startup path: alias resolution →
synchronous device-cache check → consent notice naming the artifact and
origin → download through the HTTP port → validation → cache → "restart
Obsidian to apply" notice. Decline is permanent (settings becomes the only
entry point). A plugin update misses the versioned cache and re-downloads
silently under the existing consent. Every failure path degrades atomically to
English. All behavior asserted through the runtime seam with fake ports and
fixture packs; notices surface as data per the ui-seams policy.

**Blocked by:** 3.

- [x] A valid cached pack installs synchronously at load; no network request happens before consent
- [x] Consent notice offers the install, naming file and origin; accept downloads, validates, caches, and raises the restart notice
- [x] Decline persists — the user is never auto-prompted again
- [x] After a plugin update, the pack refreshes automatically without re-prompting, followed by the restart notice; the interim session runs English
- [x] Invalid, oversized, wrong-locale, wrong-schema, offline, and failed-download paths all leave English installed
- [x] Cache lives in device-scoped local storage keyed by plugin version + locale
- [x] All lifecycle behavior is covered at the runtime seam with fake ports

## 6. Settings item for the Language Pack

**What to build:** A settings entry showing the resolved locale and pack state
(installed / cached / none), offering install — including after an earlier
decline — with the same network disclosure and restart notice, following the
existing setting-tab conventions.

**Blocked by:** 5.

- [x] Settings shows resolved locale and current Language Pack state
- [x] Install from settings works after a prior decline and repeats the disclosure
- [x] Successful install from settings raises the restart notice
- [x] The entry follows the existing declarative setting-tab structure and its pre-1.13 compat path

## 7. Distribution and disclosure

**What to build:** The release workflow clobber-uploads every emitted pack to
the single rolling release (dedicated fixed tag) using only the built-in
token; the plugin's pinned origin points at those fixed URLs; the README
gains the "Network use" paragraph naming the artifact and origin.

**Blocked by:** 4.

- [x] Each release run uploads all packs to the rolling release; re-running with unchanged packs publishes byte-identical assets
- [ ] Anonymous HTTPS fetch of the fixed URL returns the freshly published pack (curl-level verification, no GitHub API)
- [x] The plugin's pinned origin resolves to the rolling release's fixed filenames
- [x] README documents the network behavior; wording matches the consent notice

External verification pending: the anonymous fixed URL returned HTTP 404 on
2026-07-28 because the rolling release has not been published. The release
workflow now creates it and gates completion on an anonymous byte comparison.

## 8. Typed Message Inputs and the base-locale input contract

**What to build:** Replace the facade's `NonNullable<unknown>` input type with
`string | number`, widened for `datetime` arguments and narrowed to `number`
where base-locale usage says so, and make the base locale the sole authority
on which inputs a Message takes — dropping and reporting locale Messages that
reference inputs the base does not declare, rather than letting the Inlang
plugin's union of per-locale declarations turn a translation edit into a
required call-site parameter. Packs carry per-Message declarations instead of
that unioned bundle-level set.

**Blocked by:** None — the compiler and runtime it edits are already in place.

- [x] Inputs type as `string | number`; a `datetime` argument also admits `Temporal.Instant` / `Temporal.PlainDate`, and the facade imports `Temporal` as a type only when some input needs it
- [x] `plural`/`number` arguments and numeric-literal selectors narrow to `number`; conflicting usage inside the base locale widens back to the floor
- [x] Non-base narrowing is ignored — a locale-only `:number` still renders a string the caller passed
- [x] A non-base Message referencing an undeclared input is dropped from its pack and reported once, naming locale, bundle, and input; the build stays green and the untranslated report does not repeat it
- [x] A locale's own `local` declarations are preserved and never trigger the drop
- [x] A bundle with no base-locale Message is absent from the facade and every pack, with a warning
- [x] Each pack Message carries only the declarations its own variants reference; a placeholder-free translation compiles to a plain string even when the base Message takes inputs
- [x] The bundled-English render path degrades to the bundle ID with a warning instead of throwing into the caller
- [x] `expectTypeOf` covers the inferred types, fixture projects cover the drop-and-report paths, and lint/tests stay green with existing call sites unchanged

Two rejections were added beyond the original criteria, both for cases the
compiler cannot faithfully emit. A name two locales declare differently is
ambiguous after the plugin's union and previously let a translator's formatter
render the bundled English message — see the Message Input contract. A bundle
ID or input name that is not a TypeScript identifier previously emitted an
uncompilable facade; the message-format plugin reaches this through a pattern
placeholder like `{amount :number}`, which it parses as a variable named
`amount :number` rather than as an annotation.

The widened `datetime` input type is asserted as generated text rather than
with `expectTypeOf`, because no catalog message uses a `datetime` argument yet
and fixture output is never typechecked. `runtime.test.ts` declares the same
type by hand so the emitted import specifier and member types stay honest.
