# Annotation locks come from the Zotero database, apart from the Editing Capability

Zotero's reader locks an Annotation that is External or that another user created in a group library (`annotations.js`: `readOnly = isExternal || !isAuthor`), but the Local API does not enforce this: it checks only that the library is editable, so a write to an External Annotation succeeds and a PATCH to another user's Annotation fails as a bare `500`. ZotLit therefore applies the lock itself, as a Locked Annotation with a Lock Reason, separate from the Editing Capability: the capability describes the connection to an Attachment and changes with probes and authorization, while a lock is a fixed fact about one Annotation. A verb acts only when both allow it. The lock facts — `itemAnnotations.isExternal`, and `groupItems.createdByUserID` compared with the account `userID` in `settings` — are read from the Zotero database even when the Local API is the Annotation Source, because Zotero's item JSON carries neither `annotationIsExternal` nor the creator.

Accepted on 2026-09-26 with [#1233](https://github.com/aidenlx/zotlit/issues/1233). The lock facts sit beside the record set, so [ADR 0034](0034-the-annotation-source-is-atomic-per-attachment.md)'s atomic Annotation Source still holds for the Annotation data.

## Considered Options

- **A per-Annotation value of the Editing Capability** (rejected): mixes a fixed Annotation fact into a connection state defined per Attachment.
- **A ZotLit Companion endpoint that returns Zotero's own `readOnly`** (rejected): exact, but makes a correct edit gate depend on an optional install.
- **Read the lock facts from the Zotero database** (chosen).

## Consequences

- The rule follows Zotero's reader verb by verb: `external` refuses every edit and delete; `another-user` refuses every edit, tags included, but allows delete.
- Unknown facts mean not locked — the database was never read for the Attachment, the Annotation is not yet in the copy ZotLit reads, or no account `userID` exists. Zotero itself counts a missing creator or current user as the author. A new External Annotation stays editable until the copy is read again. A read of the database that fails keeps the locks the last read gave the Attachment, so a known lock does not fall away.
- A group verb on a Card Selection is all or nothing, as in Zotero's reader: it is refused when any selected Annotation refuses it.
- An undo or redo whose History Step targets a Locked Annotation is refused with the Lock Reason, and the step stays. Undoing the delete of another user's Annotation restores it under a new key with the current user as creator, so it is no longer locked.
- A `500` from a missed lock keeps its `invalid-response` mapping; ZotLit does not infer a lock from it.
