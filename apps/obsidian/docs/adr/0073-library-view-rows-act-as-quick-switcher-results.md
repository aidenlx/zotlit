# Library View rows act as quick switcher results

A row of the Library View answers the same keys as a quick switcher result, so one habit opens a paper from either: Enter opens the Literature Note, or writes it through the same Profile selection when there is none; Shift+Enter opens the PDF in Obsidian; Mod+Enter opens the Literature Note in a new pane. Double click opens the PDF, since a researcher coming from Zotero double-clicks to read. Space on the selected row opens its Reading Card where the card covers a narrow list (ADR 0070); a quick switcher result has no card, so Space there stays text. Insert citation, Copy citation key, Open PDF to the right and Show in Zotero live in the row menu, built through the existing menu-event seam, and run the operations every other surface runs: Show in Zotero opens the same `zotero://select` link as the citation popover and the References view. Dragging a row into a note inserts a citation; it is the first Item drag, with its own payload type next to the Annotation drag, and the editor drop reads both.

Proposed on 2026-10-17 with [#1549](https://github.com/aidenlx/zotlit/issues/1549).

## Considered Options

- **Enter opens the PDF, Shift+Enter the note, Mod+Enter cites** (rejected): the spec's first list. It put reading first, but the quick switcher binds Enter to the note, and two surfaces that open the same paper with different keys teach two habits.
- **Rebind the quick switcher to Enter = PDF as well** (rejected): it changes a habit researchers already have, for a surface they have not used yet.
- **The quick switcher's keys** (chosen): Cite moves to the row menu, where Zotero users look for it.
- **A Library-only "Show in Zotero" that checks Zotero first** (rejected): a second behaviour for one action. When Zotero is closed, the operating system starts it from the link. Opening a `zotero://` link gives no failure signal, so nothing warns when no handler is installed.

## Consequences

- Each key acts on the selected row; arrow keys move the selection, and single click only selects.
- The quick switcher gains "Show in Library", which opens the Library View on the Item's first Collection.
- The row menu is the one place that lists every action; the Reading Card (#1552) reuses its operations.
- The quick switcher's "Show in Library" is Alt+Enter (⌥↵). It opens the Item's first Collection, or its Library when the Item is in none, clears the search, and selects the row.
- One module opens notes and PDFs for both the quick switcher and the rows, so the two keep the same keys and Profile selection.
- The row menu raises `zotlit:item-menu` (`{source: "library-view", indexedKey}`, sections `open`, `insert`, `clipboard`, `zotero`) after its own entries, so other plugins can add theirs.
- An Item drag outside a note carries the `zotero://select` link as text. Insert citation goes to the note that was active last, because Obsidian names no active editor while the Library View tab is active. "Active last" covers notes already open when the plugin loaded, read through public workspace API (amended after review pass 4).
- The selection is session state, not part of the Library View Document. Arrow keys and the row keys do not act inside text fields, links, buttons, menus, list boxes or the tree.
- "Show in Library" also turns the facets off, so a facet never hides the row it reveals.
