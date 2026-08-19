# Context Map

## Contexts

- [Zotero Data Model](./packages/db/CONTEXT.md) — Zotero's item hierarchy, identification, and query surface as modeled by `@zotlit/db`
- [Obsidian Plugin](./apps/obsidian/CONTEXT.md) — literature notes, imported notes, templates, citations, and the services that bridge Zotero data into the vault
- [Obsidian i18n](./packages/obsidian-i18n/CONTEXT.md) — Messages, JSON Language Packs, their isolated runtime, and the headless Obsidian lifecycle
- [ZotLit Protocol](./packages/protocol/CONTEXT.md) — the wire format between the Zotero companion and the Obsidian plugin: permanent `obsidian://` URIs versus ephemeral version-gated HTTP requests
- [ZotLit Documentation](./apps/docs/CONTEXT.md) — user-facing naming and framing rules for the docs site (zotlit.aidenlx.site)
- [Fixture](./packages/scripts/CONTEXT.md) — the generated, disposable test environment (Zotero data + profile + vault) and its build vocabulary

## Relationships

- **db → obsidian**: The data model provides typed item/annotation/attachment shapes and template-data mappers; the plugin consumes them to build note content and resolve links
- **protocol ↔ obsidian**: `@zotlit/protocol` defines the URL/HTTP actions (`open`, `update`, `import-note`, `update-many`) that the Zotero companion sends and the Obsidian plugin handles
- **templates ↔ obsidian**: `@zotlit/templates` provides the Eta rendering engine and managed-region helpers; the plugin owns template discovery, compilation caching, and the `zt.*` data contract
- **obsidian-i18n → obsidian**: `@zotlit/obsidian-i18n` owns Message and Language Pack semantics; ZotLit supplies its English base locale, release locations, Locale Aliases, ports, logging, consent copy, notices, and settings UI
- **obsidian → docs**: the docs site documents the plugin's user-facing surface using the Obsidian Plugin context's vocabulary verbatim; docs-only naming (e.g. "the companion") lives in the Documentation context
- **db → fixture**: the Fixture instantiates the Zotero Data Model's concepts (Libraries, Collections, Items, Citation Keys, Child Notes, Standalone Notes) as concrete generated data; the Obsidian Plugin reads that data in End-to-end Runs
