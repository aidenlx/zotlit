# Zotero object identity is the Indexed Key; the server ID is Annotation Source data

The annotation research proposed carrying a `{ serverID, library, attachmentKey }` reference through every repository and Reader Session boundary, so that a Zotero Local API restart or a swapped database could never be mistaken for the same object. We keep the Indexed Key — `key` for the personal library, `key + "g" + groupID` for a group — as the one identity of an Attachment or Annotation across the Zotero Local API, the Zotero DB, the Obsidian PDF view, and the Zotero Reader. The `Zotero-Server-ID` lives on the Annotation Source discriminant alone, where it partitions the read cache and classifies a `412` as a version conflict or a changed server. The numeric SQLite `itemID` is adapter data inside the DB read path and the attachment resolver and crosses no other boundary.

## Considered Options

- **Server-scoped reference structs** (rejected): identity would change whenever Zotero restarts with a new database, and every consumer — the Annotation View, the Reader Session, note frontmatter — would need to carry and compare a field it never acts on.
- **Numeric `itemID` as the shared identity** (rejected): it is the prototype's currency, but it exists only in SQLite, so an Annotation created through the Zotero Local API stays invisible until the next database refresh supplies its number.
- **Indexed Key everywhere, server ID on the source** (chosen): the glossary already defines the Indexed Key for Annotations, note frontmatter already stores it, and the source is the only place that needs to know which server answered.

## Consequences

- The Annotation View re-keys its cards by Indexed Key; `itemID` stops being a prop.
- A server change invalidates the Zotero Local API cache partition without renaming any object.
- Two Zotero databases holding the same key for different objects are indistinguishable at the identity level; the source discriminant, not the key, is what detects that case.
