# The Mark Popup is one Preact root on Obsidian's popover

Supersedes the Mark Popup parts of [ADR 0042](0042-the-surfaces-inside-the-pdf-reader-are-vanilla-dom-on-obsidians-popover.md), including its amendment "the Mark Popup's tag section is a Preact island", and the Mark Popup part of the rejected option "A Preact root with signals or a store hook" in [ADR 0056](0056-reader-surface-state-is-one-vanilla-store-per-pdf-view.md). The Annotation Marks and the Creation Toolbar stay vanilla DOM, as those ADRs decide.

Decided on 2026-09-26. The Mark Popup had grown from a row of verbs into the row, the rendered comment, the comment sheet, the held-draft and Write Conflict panels, and the tag section, and the Annotation Card draws the same parts as a Preact tree. The vanilla popup emptied its row on every refresh and rebuilt most of its column, so the node under the pointer, the focused verb, and the colour verb a menu hangs from were replaced mid-gesture. It kept its own workarounds against that: a rendered-comment frame moved between rebuilt columns, a tag root moved the same way, and a hand-written split between a refresh and a rebuild.

The Mark Popup stays Obsidian's `HoverPopover` on the plugin's popout-aware base, with the same virtual anchor, pinning, dismissal, and hover parent. Its content element carries `.zt-root` and one Preact root, created as the popup opens and unmounted as it hides. The Mark Popup Host keeps its store subscription and its row filter, and on each change that passes the filter it renders the variant's element synchronously and then positions the popup; the components are pure functions of their props, with no store subscription of their own. The element is keyed by the floating kind and the Annotation, so another Annotation mounts anew and every other change is a diff in place. The popup also watches its content and centres again when it resizes, which covers a comment whose Markdown renders after the popup measured itself.

## Considered Options

- **Keep the vanilla popup and patch each fault** (rejected): each fault needs its own guard — keep the verb nodes, keep the menu's trigger, keep focus — beside the workarounds already there, and the card's Preact wrappers stay a second copy of the same parts.
- **Components subscribe to the Reader Surface State** (rejected): renders become granular, but a store-driven render is queued, not synchronous. The host measures the row's width right after a refresh to centre the popup, and the controller tests read the popup's DOM on the line after a gesture; both would need a deferred measure and awaits.
- **One root, rendered by the host** (chosen): a render commits in the same call, so the host's refresh-then-position order and the synchronous tests hold, and the diff keeps every node that did not change.

## Consequences

- The comment sheet, the rendered comment, the held-draft panel and the Write Conflict panel are shared Preact components that both the Annotation Card and the Mark Popup render. The vanilla builders stay inside them, and each redraws only when what it shows changes.
- The popup's controls are the shared Preact `IconButton`. A blocked control keeps its seat, its place in the tab order, and its reason in the tooltip. A control's colour travels as `--zt-verb-color` in its style and is applied to its glyph, because Obsidian declares a `clickable-icon`'s own colour unlayered.
- The comment sheet and the tag editor are owned by their components. The controller keeps ref handles for the calls it makes: reading the sheet's text, ending the tag session, and testing whether a press belongs to the tag section or its suggestion popup. Owners still end a session before the host renders; a render that a session's end sets off runs after the render in progress.
- The theme hooks keep their names and places: `zt-pdf-mark-popup`, `data-zt-verb`, `zt-pdf-comment-sheet`, and `data-zt-section="tags"`.
- The reader rule becomes: the Mark Popup is the one reader surface that imports Preact.

## Amendment: the selected-mode row has no comment verb

Accepted 2026-09-26 ([#1242](https://github.com/aidenlx/zotlit/issues/1242)). The comment pencil beside the popup's comment, or the "Add a comment…" line on an Annotation with no comment, is the one way into the popup's comment editor, as on the Annotation Card ([ADR 0060](0060-card-text-is-edited-only-through-explicit-controls.md)). So the selected-mode row no longer carries `data-zt-verb="comment"`; the pencil carries `zt-annot-comment-pencil`, and the line also `zt-annot-add-comment`. The creation row keeps its `data-zt-verb="comment"`. Every other theme hook above keeps its name and place.

Amended by [ADR 0066](0066-the-comment-is-an-editable-field-on-a-card-selected-alone-and-in-the-mark-popup.md): the comment is an editable field in the popup, so the pencil, the "Add a comment…" line and their theme hooks are gone. The selected-mode row still has no comment verb.
