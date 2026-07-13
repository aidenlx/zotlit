# Context Map

## Contexts

- [Zotero Data Model](./packages/db/CONTEXT.md) — Zotero's item hierarchy, identification, and query surface as modeled by `@zotlit/db`
- [Obsidian Plugin](./apps/obsidian/CONTEXT.md) — literature notes, imported notes, templates, citations, and the services that bridge Zotero data into the vault
- [ZotLit Protocol](./packages/protocol/CONTEXT.md) — the wire format between the Zotero companion and the Obsidian plugin: permanent `obsidian://` URIs versus ephemeral version-gated HTTP requests

## Relationships

- **db → obsidian**: The data model provides typed item/annotation/attachment shapes and template-data mappers; the plugin consumes them to build note content and resolve links
- **protocol ↔ obsidian**: `@zotlit/protocol` defines the URL/HTTP actions (`open`, `update`, `import-note`, `update-many`) that the Zotero companion sends and the Obsidian plugin handles
- **templates ↔ obsidian**: `@zotlit/templates` provides the Eta rendering engine and managed-region helpers; the plugin owns template discovery, compilation caching, and the `zt.*` data contract
