# The comment is an editable field on a card selected alone and in the Mark Popup

Supersedes [ADR 0060](0060-card-text-is-edited-only-through-explicit-controls.md).

On a card selected alone, and in the Mark Popup, the comment is an editable field: a click puts the caret in it, and an empty comment shows "Add a comment…" as the field's placeholder. A click on a card that is not selected alone only selects it, so a long list stays safe to read. The editor saves as the user types and ends on Escape, on a click elsewhere in the view, or on a change of Card Selection; it has no Done button. The Quoted Text is edited only through "Edit quoted text" in the card's menus, and a click on it only reads, selects, and copies. This is the split Zotero's own reader makes, which is the habit ZotLit's researchers already have.

ADR 0060 gave each field an explicit control — a pencil in a gutter beside the comment, "Edit text" in the header — and a Done button to leave. Built, that put three "stop editing" signals around one short field (a form ring, a pressed pencil, and a call-to-action button), a gutter that narrowed every selected comment, and a header glyph that non-technical users did not recognise. ADR 0060's two concerns are met another way: typing is the only thing that changes text, so selecting and copying in the field stay safe; and the placeholder, a hover fill, and the text cursor show that the field is editable. A comment's Markdown shows as its source while the field is open.

## Considered Options

- **Explicit controls with Done** (ADR 0060, rejected): visible, but verbose; the controls cost more attention than the edit.
- **Hybrid: the field plus a pencil shown on hover** (rejected): two ways in for one field, and the pencil still needs its gutter.
- **Quoted Text click-to-edit like the comment** (rejected): the quote is copied often and corrected rarely, so a click on it keeps reading and copying.

## Consequences

- While editing is blocked, the comment stays rendered text with no hover fill, and a click shows the notice that says why.
- The creation Mark Popup keeps one primary button, named for what it creates (**Highlight** or **Underline**), because creation is a commit the user must see.
- A held draft continues with a click on its text, the same gesture as a comment with no draft.
