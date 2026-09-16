# The Annotation View changes its Follow Mode only on a user gesture

An Annotation View instance shows the Attachment its Follow Mode selects: Active Tab, Zotero Reader, or Pinned. The user picks the mode from one toolbar button, the native pane menu, or a command, and the view keeps that mode until the user picks another. A source that cannot answer keeps the mode and shows its reason in place: Live updates off shows an empty state with a "Turn on live updates" action, a closed Zotero Reader keeps the last Attachment on screen under a "Zotero reader closed" line, and an active leaf that resolves to nothing shows the empty state. Unpin returns to the mode the view was in before the pin.

## Considered Options

- **Revert to Active Tab when the Zotero Reader source goes away** (the behaviour before this decision, rejected): the view changed what it followed with no gesture, so a user who turned the Local Server off found the list replaced by an unrelated note's annotations with nothing that said why.
- **Merge sources, last event wins** (rejected by the architecture decision behind Reader Session): two readers open on different Attachments would fight for the view.
- **Pin as a flag over a follow mode** (rejected): two visible states for one choice; the header could not name the mode in one word.
- **Explicit mode, held until the next gesture** (chosen).

## Consequences

- Pinned is one shape: an Item plus a remembered attachment choice. A pin taken from an Obsidian PDF view releases that view's attachment lock; the attachment line becomes a live picker that starts on the Attachment the PDF showed.
- Active Tab adds to the view only what the active leaf cannot show. With a Literature Note or an Obsidian PDF view in front, the Item title and creators stay hidden, and the attachment picker appears only when a note's Item has more than one attachment. Zotero Reader and Pinned show the identity block, because nothing else on screen names the Item.
- "Zotero reader closed" needs a Companion event the notify protocol does not carry today: `reader/inactive`, sent when the focused Zotero tab or window is no longer a reader. The Obsidian side keeps the last Reader Session target and flags it closed.
- Mode and pin persist in the view's workspace state, so each Annotation View instance keeps its own choice across restarts; no plugin setting holds a default.
