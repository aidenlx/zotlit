# Annotation History is per Attachment, checked by field value when undone, and restores under a new key

The Geometry Edit and ink specs (#1200, #1207) left undo out because "Zotero holds no history, and neither does ZotLit". ZotLit now keeps an Annotation History: an ephemeral record of its own confirmed edits, one per Attachment, recorded in the annotation repository that every surface already writes through. It starts when the first PDF view of the Attachment opens and ends when the last one closes. A History Step holds the before and after values of the fields it changed, taken from confirmed records, so a failed write never enters it. An undo is an ordinary write through the same verbs: it first compares the step's after values with the current confirmed record, writes the before values when they match, and otherwise drops that one step with a notice. Redo is built from the undo's confirmed result, and a new edit clears it.

## Considered Options

- **One history per PDF view, as Zotero's reader keeps one per reader** (rejected): an edit from a card or from a second view of the same PDF would be a foreign change to it, so ZotLit's own edits would cut its own history.
- **Cut every step on an Annotation when Zotero reports a change to it, as Zotero's reader does** (rejected): it needs a listener on outside changes and throws away steps whose fields Zotero never touched. A check at undo time needs neither, and an outside edit to a different field does not block the undo.
- **Check the Zotero version recorded with the step** (rejected): each undo of an earlier step on the same Annotation bumps the version, so a chain of undos would fail its own check. The field check passes an equal value, which matches the Write Conflict rule that an equal Zotero value is no conflict.
- **Restore a deleted Annotation under its old key** (rejected): delete is an erase, and Zotero 10 refuses a client-supplied key on create. The re-created Annotation gets a new key, and the history renames the old key in every step, as Zotero's reader does.

## Consequences

- An undo of a delete, or a redo of a create, gives the Annotation a new Zotero key. Links in notes, excerpt images, and `obsidian://` URIs that name the old key no longer resolve. The app shows no notice for this; the docs page on annotation editing states it.
- An undo is a write: it needs the Editing Capability and is ignored while a write on the Attachment is pending or an Annotation the step touches has an open Annotation Draft.
- The history holds at most 100 steps and lives in memory only (ADR 0048).
