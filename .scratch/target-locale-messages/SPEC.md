# Target-Locale Messages

Status: ready-for-agent

## Problem Statement

A user running Obsidian in a supported non-English language (today: Simplified
Chinese) is offered the ZotLit Language Pack through a consent notice, an
Install button, and a settings-row description — all rendered in English,
because the fallback ladder consults only the active Language Pack and no pack
is installed at that moment. The audience least able to read English is the
only audience these strings exist for. The notice also names the language as a
bare BCP-47 code ("zh-CN") rather than anything the user would recognize.

## Solution

All Language Pack Lifecycle copy — the consent notice and its actions, the
settings row, and the download/restart/failure/reset notices — always renders
in the user's resolved target locale, from strings bundled with the plugin,
regardless of whether a Language Pack is installed. Wherever that copy names a
language, it uses the language's Endonym ("简体中文") instead of the locale
code. The mechanism is a reusable feature of the i18n package: Messages
selected by configurable key prefixes become Target-Locale Messages, compiled
into per-locale subsets that ship inside the plugin and render through the
same guarded fallback semantics as everything else.

## User Stories

1. As a Simplified-Chinese Obsidian user without an installed Language Pack, I want the consent notice in Chinese, so that I can understand what I am consenting to before anything downloads.
2. As a Simplified-Chinese Obsidian user, I want the consent notice's Install and Don't-ask-again actions in Chinese, so that I know which button does what.
3. As a Simplified-Chinese Obsidian user, I want the Language Pack settings row's name, description, and install button in Chinese, so that the settings entry point is as readable as the notice.
4. As a Simplified-Chinese Obsidian user, I want the offer to name the language as 简体中文 rather than "zh-CN", so that I recognize my own language instead of decoding a tag.
5. As a Simplified-Chinese Obsidian user, I want the downloading, restart-required, download-failed, and update-needed notices in Chinese, so that the whole install journey stays readable.
6. As a Simplified-Chinese Obsidian user who is offline on first launch, I want that copy to render in Chinese without any network access, so that comprehension never depends on a download.
7. As a Simplified-Chinese Obsidian user with the Language Pack active, I want the reset confirmation and reset notice in Chinese, so that lifecycle copy is consistent in every Language Pack Situation.
8. As an English-locale user, I want identical behavior to today, so that the feature costs me nothing.
9. As a user of a locale with no shipped Language Pack, I want the existing English fallback and no offer, so that nothing changes for me.
10. As a Simplified-Chinese Obsidian user, I want target-language-only copy (not bilingual), so that notices stay short and unambiguous.
11. As a ZotLit maintainer, I want the Target-Locale Message set selected by key prefix, so that new lifecycle strings are covered automatically without a config edit.
12. As a translator, I want a locale missing one of these Messages to degrade per-message to the base locale, so that a half-translated locale still builds and runs.
13. As a maintainer adding a future pack locale, I want its lifecycle-copy subset bundled automatically by the compiler, so that the guarantee scales with the Locale Catalog.
14. As a developer of another Obsidian plugin using the i18n package, I want the same prefix-configurable mechanism, so that my own consent copy can be readable pre-consent.
15. As a developer consuming the generated facade, I want Target-Locale Messages called through the same message wrappers as every other Message, so that adopting the feature is configuration-only and call sites stay untouched.
16. As a maintainer, I want language Endonyms defined once in a dedicated table of Obsidian's supported languages, so that no consumer restates per-locale display names by hand.
17. As a privacy-conscious user, I want the consent-gated download semantics unchanged, so that bundled copy never turns into an unconsented network fetch.

## Implementation Decisions

- **Scope by prefix.** Every Message whose key starts with `notice_language_pack_` or `settings_language_pack_` becomes a Target-Locale Message in ZotLit. General tooltips, `aria-label` hints, and all other Messages keep the existing fallback ladder unchanged.
- **Compiler option.** The compiler gains `targetLocaleMessagePrefixes: readonly string[]` (empty default), working identically across the compiler API, CLI, and Vite integration, mirroring the existing `excludeMessagePrefixes` option. For each locale in the Locale Catalog, the compiler emits a subset containing the matching Messages; these subsets are embedded in the generated runtime artifacts and bundled into the plugin, not shipped as remote Language Packs. The base locale carries no subset of its own — the ladder already falls through to the bundled base pack, so one would be dead weight.
- **Transparent facade.** The generated message wrappers keep their existing names and signatures. Wrappers for prefix-matched Messages render through the target-locale path; all other wrappers are unchanged. Consumers adopt the feature purely through configuration.
- **Runtime surface.** The runtime gains a way to set the target locale. Target-Locale Messages render unconditionally from the bundled subset for that locale — the active Language Pack is never consulted for them. Rendering reuses the guarded per-message ladder: target subset → base locale → bundle ID, with the existing warning log and deduplication.
- **Lifecycle wiring.** The Language Pack Lifecycle sets the runtime's target locale as part of locale resolution during construction, before any consent UI can render. Until it is set, Target-Locale Messages render base-locale text through the same guarded ladder.
- **Endonym source.** Obsidian supports a closed set of display languages, so the package owns one dedicated static table mapping Obsidian language codes to Endonyms. The lifecycle exposes the Endonym for the resolved language; a code missing from the table falls back to the canonical locale code. Neither the Locale Catalog nor compiler configuration carries endonym data.
- **Endonym everywhere.** Every piece of lifecycle copy that names a language interpolates the Endonym instead of the raw locale code, in both the base-locale and translated texts. The base locale needs no special entry — lifecycle copy never names the base language.
- **Cost accepted.** Bundled subsets grow with each pack locale; this is accepted without a size ceiling. Presentation is target-language only, never bilingual.
- **Consent unchanged.** Consent continues to gate the network download of full Language Packs. Bundled subsets ship with the plugin and are not consent-gated, because no download occurs.

## Testing Decisions

- Good tests exercise external behavior at public seams — generated artifact behavior, rendered message output, and Language Pack Situation transitions — never internal representation of the subsets or wrapper routing.
- **Compiler seam** (existing pattern: pack generation over fixture Inlang projects): asserting that configured prefixes produce per-locale subsets, that excluded or unmatched Messages stay out of them, and that generated wrappers for matched Messages render target-locale text.
- **Runtime seam** (existing pattern: runtime construction plus translate assertions): setting the target locale, unconditional target rendering that ignores the installed Language Pack, and the guarded target → base → bundle-ID fallback for missing subset Messages.
- **Lifecycle seam** (existing pattern: lifecycle initialization with fake ports): the target locale is applied during locale resolution before the offer is observable, and the resolved Endonym is exposed, including the fallback for a code missing from the table.
- **App contract seam** (existing pattern: real-project generation contract test plus settings-copy tests): ZotLit's prefix configuration yields target-locale rendering for lifecycle keys, and settings and notice copy interpolate the Endonym.

## Out of Scope

- Target-language rendering for general tooltips, `aria-label` hints, or any Message outside the configured prefixes — the broader TODO question closes as works-as-designed.
- Bilingual presentation of any copy.
- Deriving endonyms at runtime via `Intl.DisplayNames`.
- A compile-time size budget or completeness check for the bundled subsets beyond the existing diagnostics.
- New pack locales, a display-language selection UI, or changes to Locale Alias resolution.
- Changes to consent, caching, download, or restart semantics of the Language Pack Lifecycle.

## Further Notes

- Recorded as ADR 0014 (lifecycle copy renders from bundled Target-Locale Messages, bypassing the fallback ladder).
- The glossary terms Target-Locale Messages and Endonym are defined in the Obsidian i18n package context.
- This resolves the "Hint UI text in the target language" follow-on deferred out of the package-extraction spec, which froze the ladder at extraction time.
