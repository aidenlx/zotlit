# Imported notes are mirrors, not literature notes

Zotero Items can have Child Notes (rich-text notes attached to a library item). When ZotLit imports a Child Note into the vault, the resulting Obsidian file is an **Imported Note** — a managed mirror identified by `zotero-note-key` in frontmatter — **not** a Literature Note.

The two note kinds are kept disjoint: `zotero-key` (Literature Notes) and `zotero-note-key` (Imported Notes) never appear on the same file. The Note Index maintains separate maps for each. `isLiteratureNote()` only checks `zotero-key`, so imported notes never pollute Literature Note lookups, citation resolution, or the update/overwrite flows.

We considered unifying them — a single `zotero-key` field covering both items and child notes, with a discriminator. We rejected this because:

- **Different update contracts.** Literature Notes use managed-region overwrite (preserve user content outside `%%zt-managed%%`). Imported Notes use whole-body overwrite (the file is a clean mirror of the Zotero note; explicit re-import signals intent to replace everything).
- **Different Zotero sources.** A Literature Note's source is a Zotero Item (article, book, etc.). An Imported Note's source is a Child Note (rich-text HTML). They have different schemas, different queries, and different template data shapes.
- **Index pollution.** If both shared `zotero-key`, every feature that looks up "the literature note for this item" would need to filter out imported notes. The disjoint keys make the wrong lookup a type error, not a runtime bug.

The trade-off: two parallel identity paths through the Note Index, two sets of frontmatter conventions, and protocol actions that must know which kind of note they're targeting. This complexity is justified by the clean separation it buys.

## Consequences

- `NoteIndex` has three maps (`#notesByItemKey`, `#notesByCitekey`, `#notesByNoteKey`), not two.
- `zt.notes` in the Literature Note template context is link-only (`{ key, title, noteLink() }`), not inline content — the imported note is a separate file, not embedded text.
- Re-import is always explicit (protocol action or command); auto-materialization during Literature Note create/update is skip-if-exists only.
