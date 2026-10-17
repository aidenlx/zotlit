# Library View rows act as quick switcher results

A row of the Library View answers the same keys as a quick switcher result, so one habit opens a paper from either: Enter opens the Literature Note, or writes it through the same Profile selection when there is none; Shift+Enter opens the PDF in Obsidian; Mod+Enter opens the Literature Note in a new pane. Double click opens the PDF, since a researcher coming from Zotero double-clicks to read. Insert citation, Copy citation key, Open PDF to the right and Show in Zotero live in the row menu, built through the existing menu-event seam, and run the operations every other surface runs: Show in Zotero opens the same `zotero://select` link as the citation popover and the References view. Dragging a row into a note inserts a citation; it is the first Item drag, with its own payload type next to the Annotation drag, and the editor drop reads both.

Proposed on 2026-10-17 with [#1549](https://github.com/aidenlx/zotlit/issues/1549).

## Considered Options

- **Enter opens the PDF, Shift+Enter the note, Mod+Enter cites** (rejected): the spec's first list. It put reading first, but the quick switcher binds Enter to the note, and two surfaces that open the same paper with different keys teach two habits.
- **Rebind the quick switcher to Enter = PDF as well** (rejected): it changes a habit researchers already have, for a surface they have not used yet.
- **The quick switcher's keys** (chosen): Cite moves to the row menu, where Zotero users look for it.
- **A Library-only "Show in Zotero" that checks Zotero first** (rejected): a second behaviour for one action. When Zotero is closed, the operating system starts it from the link; the Library View warns only when the link cannot be opened.

## Consequences

- Each key acts on the selected row; arrow keys move the selection, and single click only selects.
- The quick switcher gains "Show in Library", which opens the Library View on the Item's first Collection.
- The row menu is the one place that lists every action; the Reading Card (#1552) reuses its operations.
