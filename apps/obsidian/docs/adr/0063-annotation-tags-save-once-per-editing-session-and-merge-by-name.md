# Annotation Tags save once per editing session and merge by name

Decided in the Annotation Tags grilling (2026-09-25). A tag editing session starts when the tag editor opens inline, from the Annotation Card's tag toggle, a click on the empty space of its tag row, or the Mark Popup's tag verb. It ends when the editor closes, on blur or Escape. Blur and the tag toggle add the text that is typed but not yet added. Escape ends the session without that text. During the session the Annotation Draft holds the tags the session started from and the current tags, so the Annotation View and the Mark Popup show the same draft. Enter adds the typed name, a comma is an ordinary character because a Zotero tag name can contain one, and an exact, case-sensitive duplicate is ignored.

At close, the repository sends one Local API write. It applies the session's added and removed names to the Annotation's current confirmed tags and sends the whole list, because Zotero replaces the list. A kept tag keeps its type, a new tag is manual, and an automatic tag can be removed, as in Zotero. Tags never raise a Write Conflict: a tag that Zotero added or removed during the session stays in the merged list, and a precondition failure re-reads the Annotation and applies the same names again, once. A second precondition failure holds the draft as a failed save. A tag save is therefore a pending write but not a `ConflictedWrite`. This follows the Write Conflict rule that a Zotero value already equal to the intended one is no conflict, applied per name.

One session is one History Step. Its undo is the reverse of the merge: it removes the names the session added and adds back the names it removed, with their old types, against the current tags. This replaces, for tags alone, [ADR 0059](0059-annotation-history-is-per-attachment-checked-by-field-value-and-restores-under-a-new-key.md)'s check that the step's after values still equal the confirmed record.

While the write is in flight, the editor stays open in a saving state with its input and remove buttons disabled. It closes onto the confirmed chips when the read-back arrives. The card and the popup therefore keep [ADR 0048](0048-annotation-drafts-and-pending-writes-stay-in-memory.md)'s rule of confirmed data while pending, and the chips do not switch back to the old tags for a moment. The verbs do not stand down for the session's save, because the editor already shows it. A tag undo or redo is a gesture's write, so it stands the verbs down and shows pending, as other undo writes do.

The tag draft follows ADR 0048's comment rules for authorization and failure, as [ADR 0062](0062-editing-requires-a-remembered-authorization-and-allow-leaves-zotlit-read-only.md) leaves them. If editing becomes unavailable while the editor is open, or Zotero refuses the save, or the response is lost, the draft is held with the same reason lines as a comment draft. The researcher selects **Save tags** before automatic saving resumes.

## Considered Options

- **A write for each added or removed chip, as in Zotero's tag box** (rejected): each chip is a pending write, a History Step, and a possible conflict, and the card shows a saving state after every chip.
- **Autosave on a typing pause, as for a comment** (rejected): tags are discrete, so there is no typing burst to protect.
- **Compare the whole list and show the conflict panel** (rejected): it asks the user to pick between two lists that merge without loss.
- **Close at once and draw the draft chips as pending** (rejected): it breaks ADR 0048's rule of confirmed data while pending. Closing at once and drawing the confirmed chips makes them flicker.

## Consequences

- While the Editing Capability is off, the card's tag toggle follows the comment toggle: it stays pressable and dimmed, and a press shows the capability notice with the reason. The Mark Popup's tag verb is disabled with the reason in its tooltip, as the popup's other editing verbs are. Both follow [ADR 0047](0047-annotation-reading-is-continuous-and-editing-is-an-added-capability.md). The chips still show, and a chip click still toggles the Annotation Filter.
- A card whose new tags no longer satisfy the Annotation Filter leaves the list when the save is confirmed.
- In the Mark Popup, a session also ends on the tag verb's second press, when the selection moves to another mark, when the popup hides, and when the editor unmounts, as it does when the PDF view closes. Each end saves the session once. The tag editor and the comment editor are mutually exclusive in the Mark Popup: opening one closes the other, and the comment editor stores its text first.
- The creation Mark Popup has no tag verb. The popup reopens on the new mark, where tags can be added. Tags in the create request can come later without a change to this model.
- Tag names are suggested from the tags of the Annotation's Library.
- The Template Workbench's chip input now uses the same shared tags input. It ignores an exact duplicate, and it trims a suggestion that it accepts.
