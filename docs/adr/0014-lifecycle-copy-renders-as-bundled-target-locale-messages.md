# Lifecycle copy renders as bundled Target-Locale Messages

The Language Pack consent and lifecycle copy rendered in English at exactly
the moment a non-English user must read it: the fallback ladder consults only
the active pack, and no pack is installed when consent is requested. We bundle
per-locale subsets of prefix-selected Messages (Target-Locale Messages) into
the plugin and render them unconditionally in the resolved locale, naming
languages by their Endonym from a package-owned table of Obsidian's supported
languages — accepting per-locale bundle growth so consent copy is readable
pre-consent and offline, without weakening the download-consent design for
full Language Packs.

## Considered Options

- Bundling the full translated pack and installing it without consent —
  rejected: it dissolves the consent and size design the packs exist for.
- Deriving language names via `Intl.DisplayNames` or a reserved message key —
  rejected: Obsidian's display-language set is closed, so a dedicated static
  table is simpler and deterministic across platforms.
