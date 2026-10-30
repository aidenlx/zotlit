# Card text is edited only through explicit controls

Superseded by [ADR 0066](0066-the-comment-is-an-editable-field-on-a-card-selected-alone-and-in-the-mark-popup.md).

An Annotation Card's Quoted Text and comment open an editor only from a control made for that purpose: "Edit text" in the card's header, and a pencil in a gutter beside the comment. Both show on the selected card alone. A click on the text itself selects the card and leaves the text free to read, select, and copy. This replaces the click-to-edit comment of [#1145](https://github.com/aidenlx/zotlit/issues/1145), and the Mark Popup follows the same rule.

ZotLit's users are researchers, many of them not technical. Text that turns into an editor when clicked gives no sign that it is editable, and it turns reading and copying into an accidental edit. A control near the field says what it does. The control must never cover the text it edits, so it sits in space the card already has or gains on selection. Selecting a card also removes its line clamp, so the whole text is visible before an edit starts, and entering the editor moves nothing but the footer row that holds **Done**.

## Considered Options

- **Click on the text to edit** (the #1145 comment): one click, but no visible affordance and it conflicts with selecting and copying.
- **Select, then click the text** (Zotero's reader): safe for reading, but still invisible to a user who does not know it.
- **One card-level Edit mode for both fields**: explicit, but it opens two editors at once, which breaks one-editor-at-a-time and one History Step per session.
- **Labelled action row on the selected card**: the most explicit, at the cost of a row of text buttons on every selected card.
