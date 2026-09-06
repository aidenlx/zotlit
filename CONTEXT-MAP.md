# Context Map

## Contexts

- [Zotero Data Model](./packages/db/CONTEXT.md) — Zotero's item hierarchy, identification, and query surface as modeled by `@zotlit/db`
- [Filter Expression](./packages/filter-expression/CONTEXT.md) — the ZotLit-owned language of filter expressions
- [Obsidian Plugin](./apps/obsidian/CONTEXT.md) — literature notes, imported notes, templates, citations, and the services that bridge Zotero data into the vault
- [Obsidian i18n](./packages/obsidian-i18n/CONTEXT.md) — Messages, JSON Language Packs, their isolated runtime, and the headless Obsidian lifecycle
- [ZotLit Protocol](./packages/protocol/CONTEXT.md) — the wire format between ZotLit Companion, the Zotero add-on, and the Obsidian plugin: permanent `obsidian://` URIs versus ephemeral version-gated HTTP requests
- [ZotLit Documentation](./apps/docs/CONTEXT.md) — user-facing naming and framing rules for the docs site (zotlit.aidenlx.site)
- [ZotLit Companion](./apps/zotero/CONTEXT.md) — the Zotero-side add-on: what it observes in Zotero, and how it keeps Zotero's database readable by the Obsidian plugin
- [Fixture](./packages/scripts/CONTEXT.md) — the generated, disposable test environment (Zotero data + profile + vault) and its build vocabulary

## Relationships

- **db → obsidian**: The data model provides typed item/annotation/attachment shapes and template-data mappers; the plugin consumes them to build note content and resolve links
- **filter-expression → obsidian**: the language defines Filter Expression syntax and its typed tree; the plugin validates Profile Match conditions against its own field vocabulary and evaluates them against Zotero Items
- **protocol ↔ obsidian**: `@zotlit/protocol` defines the URL/HTTP actions (`open`, `update`, `import-note`, `update-many`) that the Companion sends and the Obsidian plugin handles
- **templates ↔ obsidian**: `@zotlit/templates` provides the Eta rendering engine and managed-region helpers; the plugin owns template discovery, compilation caching, and the `zt.*` data contract
- **obsidian-i18n → obsidian**: `@zotlit/obsidian-i18n` owns Message and Language Pack semantics; ZotLit supplies its English base locale, release locations, Locale Aliases, ports, logging, consent copy, notices, and settings UI
- **obsidian → docs**: the docs site documents the plugin's user-facing surface using the Obsidian Plugin context's vocabulary verbatim; docs-only naming follows the global ZotLit Companion rule in `policies/vocabulary.md`
- **db → fixture**: the Fixture instantiates the Zotero Data Model's concepts (Libraries, Collections, Items, Citation Keys, Child Notes, Standalone Notes) as concrete generated data; the Obsidian Plugin reads that data in End-to-end Runs
- **zotero → obsidian**: the Companion keeps the main Zotero database file current so the Obsidian Plugin's Read Modes — Immutable Source above all — see recent edits; the two contexts share no code, only that file and the protocol
