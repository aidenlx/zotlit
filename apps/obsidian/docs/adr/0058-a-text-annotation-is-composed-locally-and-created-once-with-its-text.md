# A text Annotation is composed locally and created once with its text

The text tool in Obsidian's PDF reader opens a Text Draft at a click: a textarea over the page, held in the Reader Surface State and in no store of Zotero's. Its box is refitted in Obsidian on each input by a port of Zotero's own box fit. When the draft is finished (Escape, a press elsewhere, blur, a tool change, or the view's disposal), text beyond whitespace is created through the Zotero Local API as one text Annotation, with the typed text as its comment, its fitted box, and the Page Label and Sort Index computed from that box. A draft with no text creates nothing. The draft stays drawn while the create is in flight, and the read that holds the record removes it in the same update.

Zotero's reader works the other way: it creates an empty text Annotation at the press, saves each keystroke as an update, and deletes the Annotation if it is still empty at the next deselect. Over the Local API that would be one create and a stream of patches per text box, a visible empty Annotation in Zotero while the user types, and a cleanup delete that ZotLit would have to own through every failure, including a view that closes before the delete runs.

## Considered Options

- **Create empty at the press and patch each keystroke, as Zotero does** (rejected): many writes per box, each through the capability gate and the version check, and an empty Annotation that exists in Zotero until ZotLit deletes it.
- **Create empty at the press, patch once at the finish** (rejected): still two writes and a delete path for an empty box, and Zotero shows an empty Annotation while the user types.
- **Compose locally, create once at the finish** (chosen): one write per text Annotation, through the one create path every tool uses; ZotLit never writes an empty text Annotation that it must delete.

## Consequences

- A text Annotation appears in Zotero only when the user finishes typing, not at the click. This is the one visible difference from Zotero.
- The Text Draft, the saved mark, and the box fit use one font and one measure, so the lines the user typed are the lines the saved mark draws. The fitted box is widened to Zotero's stored thousandths of a point, so rounding cannot wrap a line that fitted. Zotero refits the box in its own font at its own next edit.
- The Sort Index comes from the fitted box, as a Geometry Edit's does; Zotero's comes from the square at the press. The two can differ by the characters between them.
- A create that fails, or a capability that lapsed before the finish, takes the draft off the page and reports through the create failure notice; the typed text is lost.
