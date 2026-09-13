# Obsidian i18n

The reusable, eval-free Message compiler, JSON Language Pack runtime, and
headless Obsidian lifecycle consumed by ZotLit and other Obsidian plugins.

## Language

**Message**:
A keyed, translatable user-facing string in an Inlang source catalog,
optionally taking named inputs. A consumer may exclude key prefixes from its
generated artifacts.
_Avoid_: token, translation string

**Included Message**:
A Message a consumer names by bundle ID so it enters the facade and every Language Pack although a key-prefix exclusion would drop it. The facade exports it under its literal ID.
_Avoid_: opt-in key, allowlisted message

**Message Input**:
A named value a Message takes from its call site. The base locale alone
determines which inputs a Message has and what each one accepts; another locale
may use fewer. A locale Message that needs an input absent from the base locale
falls back until the base declares it.
_Avoid_: parameter, variable, placeholder

**Language Pack**:
A validated JSON artifact carrying one locale's Messages for an Obsidian
plugin. The base pack initializes an isolated generated runtime; other packs
enter that runtime only after validation at a consumer-controlled trust
boundary.
_Avoid_: language (reserved for authoring or template languages), locale module

**Language Pack Lifecycle**:
The per-device progression by which an available Language Pack is offered,
consented to, cached, and made active after restart. Consent persists across
plugin releases, while version-scoped caches refresh each release's matching
pack. A reset drops every locale's cache and consent, returning the device to
its first-run state after the next restart.
_Avoid_: pack loader (too narrow), updater (implies live application)

**Language Pack Situation**:
The Language Pack Lifecycle's current state for the resolved locale, exposed as
one of `unavailable`, `offered`, `installable`, `downloading`, `restart-pending`,
or `active`. A consumer renders one arm; it never re-derives lifecycle rules
from separate flags.
_Avoid_: snapshot (the shape was flags, not a situation), status

**Locale Catalog**:
The compiler-emitted artifact declaring a project's base locale and its remote
Language Packs (locale to pack filename). The Language Pack Lifecycle consumes
it verbatim, so a consumer never restates its locale set by hand.
_Avoid_: manifest, locale list

**Pack Source**:
The consumer-supplied release location — base URL and origin — that remote
Language Packs download from. The lifecycle composes each pack URL from the
Pack Source and the Locale Catalog's filename.
_Avoid_: pack location, download config

**Locale Alias**:
A consumer-supplied mapping from an Obsidian language code to a locale in that
consumer's catalog. An unmatched code resolves to the catalog's base locale.

**Target-Locale Messages**:
Messages selected by consumer-configured key prefixes that always render in
the resolved target locale from strings shipped with the plugin, independent
of the active Language Pack. They exist so copy about installing a Language
Pack is readable before that pack is installed.
_Avoid_: hint text, pinned messages, bundled messages (the base pack is also
bundled)

**Endonym**:
A language's name written in that language ("简体中文"), used wherever copy
names a Language Pack's language.
_Avoid_: native name, display name, language name
