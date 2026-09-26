# The Annotation View owns its Card Selection; a bound reader is kept in step

Each Annotation View instance holds its own Card Selection: none, one, or several Annotation Cards, in every Follow Mode. A card click changes the view first. The reader the Follow Mode follows is kept in step with it: an Obsidian PDF view both ways, the Zotero Reader into the view only. This reverses the model of [#1146](https://github.com/aidenlx/zotlit/issues/1146) and [#1148](https://github.com/aidenlx/zotlit/issues/1148), where the reader owned the selection and the view mirrored it.

Under the mirror, a card could be selected only while an Obsidian PDF view was bound. Pinned, the Zotero Reader, and a Literature Note tab selected nothing, so no card-level control could depend on selection. Explicit edit controls ([ADR 0060](0060-card-text-is-edited-only-through-explicit-controls.md)) and group verbs both need a selection that exists without a reader.

## Considered Options

- **The reader owns the selection and the view mirrors it** (the #1146/#1148 model, rejected): no selection without an Obsidian PDF view, and the Zotero Reader cannot take a selection from ZotLit ([ADR 0036](0036-local-api-enablement-is-a-guided-manual-step-in-zotero.md)), so its mode could never select.
- **The view owns the selection with no reader link** (rejected): the PDF and the list would disagree about what is selected, and a mark click would no longer find its card.
- **The view owns the selection; the bound reader is kept in step** (chosen): the view works alone, and a bound reader stays in step with it.

## Consequences

- A card click in the view changes the Card Selection. With an Obsidian PDF view bound, the reader lands quietly on the mark (a Mark Landing, no Mark Popup).
- A selection change reported by the bound reader, a clear included, replaces the Card Selection. So does each Zotero Reader push. While an editor is open on a card, the change waits and the latest reader state applies when the editor closes.
- A Follow Mode change or an Attachment change clears the Card Selection. A filter change drops the cards it hides. A deleted Annotation leaves it. Nothing persists.
- A card opens its full text and offers edit controls only when it is selected alone. A card selected with others offers neither, as in Zotero's own sidebar, so no card is "primary".
- Pinned and a Literature Note tab bind no reader. Two views bound to the same Obsidian PDF view share a selection through that reader.
- Multi-selection uses Zotero's gestures: Cmd/Ctrl-click toggles a card, Shift-click takes a range in list order, and Cmd/Ctrl+A takes every visible card. Keys go through the view's `Scope`.

## Amendment: a card in a group keeps its tag control

Accepted 2026-09-25, revised 2026-09-26 by [#1241](https://github.com/aidenlx/zotlit/issues/1241). A card selected with others stays compact, but it still shows its tag control. A press on it first selects that card alone, then opens its editor, so an editor never opens on a card in a group. The comment pencil shows only on a card selected alone ([ADR 0060](0060-card-text-is-edited-only-through-explicit-controls.md)).

## Amendment: a blur saves the card comment editor and keeps it open

Accepted 2026-09-25. A blur saves the card's comment editor and keeps it open, as Ctrl/Cmd+Enter does; Escape or a view gesture that changes the Card Selection saves and closes it, and a reader selection change waits until then. The card's tag editor follows the same rule: a blur ends the tag editing session with its one write and keeps the editor open for the next session, as the amendment to [ADR 0063](0063-annotation-tags-save-once-per-editing-session-and-merge-by-name.md) decides.

## Amendment: the card list is a grid of rows

Accepted 2026-09-25. The list is a multi-select `grid` of `row`s that carry `aria-selected`, not a `listbox`, because each card holds controls and a `listbox` option cannot.
