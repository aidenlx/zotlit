---
status: accepted
---

# Fields and Preview are side panels of the Template Workbench View

Supersedes the companion-view parts of [ADR 0045](0045-the-profile-editor-is-a-dedicated-view-beside-the-markdown-view.md): its 2026-09-09 and 2026-09-10 amendments, and the considered option "A split pane inside the view for the preview".

## Context

The Template Workbench View, the Note Preview, and the Template Data Explorer are three Obsidian leaves. Native leaf groups ("Linked with tab") associate them. Two rules decide which editor a companion describes:

- The source binding follows the editor in the group, and the Note Preview also reads its document through `quick-preview` and vault events by file path.
- Item and Annotation selection travels on a workspace event. A grouped receiver accepts it only from its own group.

When the group loses its editor, the two rules disagree. This happens when the editor's leaf moves to another file and the Profile opens again in a new tab. The Note Preview still shows the document and its live edits, so it looks connected. But item choices no longer travel between it, the Fields pane, and the editor, in either direction. The layout code then sees "unrelated" companions, moves the editor to a pop-out, and opens duplicates.

The Note Preview is never used without its editor. The Template Data Explorer is rarely used with one. The editor already owns a render scheduler and a preview session for its Properties and Name tabs. The Note Preview builds a second scheduler and session for the same document and Item.

## Decision

- **One view, one selection.** The Template Workbench View shows Fields as a left side panel and Preview as a right side panel. Each panel reads the editor's own selection, render scheduler, and preview session. No selection event, leaf group, or editor lookup connects them.
- **Panels are the reader's to arrange.** A view action shows or hides each panel, and a drag handle sets its width. The view's saved state holds both. "Open template workbench" and Customize show both panels. A new view shows neither.
- **The Template Data Explorer stays a standalone view** for the `explore` Companion action and its command. It keeps its own Item and Annotation choice. It follows, publishes to, and inserts into no editor. Its fields are copy-only.
- **The Note Preview view type is dropped, with no migration.** A saved Explorer leaf restores as a standalone Explorer, and its group membership has no effect.
- **The Note Preview view type, the selection event, and the companion lookup are removed.** These are `zotlit:workbench-selection`, `activeTemplateWorkbench`, `subscribeActiveTemplateWorkbench`, and the companion layout opens.

### The Workbench is Effect-native, with no zustand

The merge moves the Workbench's view state to Effect Atom (`effect/reactivity`), on both hosts, following [apps/obsidian ADR 0082](../../apps/obsidian/docs/adr/0082-obsidian-views-read-effect-services-through-view-atoms.md). The goal is one owner for each fact, so that no surface can hold a stale copy:

- **`@zotlit/workbench/ui` owns a workbench model of atoms** in place of the zustand `WorkbenchStore`: the Item, Annotation, Citation example and Variant, Partial caller and Profile, tab, root, Advanced, preview settings, and editor presentation. Pure transitions `(state) => state` change it. The UI reads it through the registry provider and a model context (`@effect/atom-react`). zustand leaves the package, the web Workbench, and the Obsidian workbench.
- **The render scheduler is Effect code over that model.** Its input (source, Item Snapshot, selection, settings) is a derived atom, not a value that a host pushes. Its quiet time is a `sleep` that a newer input interrupts. Its state (result, retained, busy, stale reason) is an atom. Hosts supply only the render Effect.
- **The rest of the shared Workbench UI is Effect-native too.** The document controller publishes its source, slices, and Problems as atoms in place of its `subscribe` listeners for state. `subscribe` stays as the transaction stream for the four readers that need every CodeMirror transaction (partial boxes, the note pane, the slice ViewPlugin, and the Obsidian insert target), because an atom keeps only its last value. The host interface (`WorkbenchHost`) gives Effects and services, and no runner: the UI forks its work on the registry's runtime, so an unmount interrupts it. React components read atoms and call commands. They hold no `useState` copy of model state, no `useEffect` subscription, and no forked-Effect hook.
- **Each host mounts the model in its own registry.** Obsidian uses its view registry, seeded with `ViewServices`, and adds a per-leaf host model for panel visibility and widths, saved state, and title. The web Workbench uses a registry of its own over its connection.
- **One read per chosen Item.** A derived atom reads the chosen Item's data through the host's read (in Obsidian, `TemplateDataReads`). The tabs, the Fields panel, and the Preview panel all derive from it. A new choice interrupts the read it replaces. This removes the generation counters, the late-result guards, and the separate snapshot loads in the editor and the preview session.
- **Gestures are per-leaf commands**: choose an Item, choose an Annotation, Run, refresh, insert a field, and export Template Data. The leaf's close interrupts them.

## Considered options

- **Keep three leaves; bind a group without an editor to the active editor.** This is a small change, but it keeps two association rules and the event bus. The same class of bug comes back with the next layout state that nobody planned.
- **Re-link companions when an editor opens on their document.** This keeps strict groups, but it changes the reader's link groups without asking, and it fails for an editor that the reader unlinked on purpose.
- **Show an empty "link an editor" state.** This is consistent, but the reader gets a visible disconnect, not a sync.

## Consequences

- One render per document and Item, not two. The Preview panel cannot show an Item other than the one the editor's tabs show.
- The Preview's settings from [ADR 0048](0048-the-note-preview-keeps-its-settings-in-native-chrome.md) live in the editor's pane menu while the Preview panel shows. Show Markdown and the updated-section choice are pane-menu entries only, not view actions.
- Moving, pinning, and closing a panel as an Obsidian leaf are no longer available. Hide and width are the controls. A wide preview needs a wide window. "Open template workbench" keeps its dedicated window for this reason.
- Problems found by the Preview reach the editor's Problems area directly. The cross-view problem hand-off goes away.
- Field insertion exists only in the Fields panel, where the target editor is known.
- The web Workbench converts in the same change, because it shares the model and scheduler. `@zotlit/workbench` takes `@effect/atom-react` as a peer dependency beside React.
- The Template Workbench View joins the view-atom import bans in the Obsidian lint config when the conversion lands.
- A saved workspace that holds a Note Preview leaf shows it as a tab of an unknown view type, which the reader closes. The Preview panel starts hidden, and the reader shows it from the view action.

## Amendment (2026-11-07): the view size places the panels

Spec #1952, tickets #1953 and #1954.

- The panel state (each panel's shown flag and width, and the Preview's share of the height under the editor) lives in the shared Workbench model, not in the Obsidian host model. Both hosts own it the same way; the Obsidian view saves it with its state, and the web Workbench keeps it for the page's life.
- Where a shown panel goes is derived, never saved: a pure rule in `@zotlit/workbench/ui` places each panel from the panel state and the view size, which each host measures from its own container. A panel is a column while the editor keeps 360 px beside it, and the Preview claims the side before the Fields Panel. A Preview that does not fit goes under the editor, which keeps at least 320 px of height: its toolbar and tab rows, the tab's task line and five source lines. Each host draws the source at least five lines tall and scrolls the editor when its content needs more, so no control is cut off.
- Resizing a view changes only the placement, never what the reader chose to show. The stacked layout under 40rem is gone.

## Amendment (2026-11-07): the Fields picker, menu sizing, and shared repair commands

Spec #1952, tickets #1955, #1956 and #1957, and the final fix round.

- #1955: where the Fields Panel's column does not fit, the Fields action opens the Fields Picker, the panel's fields as a searchable list in a popover under the action. The picker's open state lives in the shared model beside the panel state and is never saved; it closes when the column fits again. The shared UI draws the list and owns its keys (one key table for both hosts); each host supplies the popover surface through its adapter: Obsidian's `PinnedPopover` with a `Scope`, and a Base UI popover on the web. The Fields action is a toggle for the column and a disclosure for the picker, and the view action, the Obsidian pane menu and the web View menu all press the same action. While the picker stands, a press on the action keeps focus in it, and focus that leaves it by keyboard closes it and goes to the action.
- #1956: every handle the view draws can be sized without a drag (WCAG 2.5.7): the Obsidian pane menu and the web View menu list a size group per drawn handle, built by one shared function. A column's widest width is the one that keeps every column in its place, past the handles the host draws; menu entries, keys and drags step from the size the view draws, and a menu entry's new size is announced.
- #1957: the commands that take the reader from a problem to its repair are one shared set (`repairCommands`) over the shared routing. Each closes the Fields Picker and changes no panel; Show problem reveals the call and announces why it fails.

## Amendment (2026-11-07): one item row, a 56rem Preview rule, and a Help action

Spec #1952, user feedback on PR #1960.

- The view names the item every panel reads once: one item row above the panels, across all of them, with the one chooser (`ItemRow` in `@zotlit/workbench/ui`). The Obsidian row carries the "Choose item" button, so the view header has no "Choose item" action; the web row carries the sample chooser. Each panel head keeps what is its own. Each host measures the box under the row, which the panels and the editor share.
- The Preview is a column in a view 896 px (56rem, Tailwind `@4xl` at the 16 px root font size) wide or wider, and goes under the editor in a narrower view. Its column grows until the editor keeps 360 px; the 40% share and the 960 px limit hold the Fields column alone. The Fields Panel keeps its rule: a column while the editor keeps 360 px beside the columns, the Fields picker otherwise. The default Preview width stays 400 px.
- The Fields Panel's button that collapses or expands every section trails its field search, in the shared Data Explorer, drawn in each host's icon-button idiom.
- Help is a view action in Obsidian and a header menu on the web. Both list the same docs pages from one shared list (`HELP_PAGES`) and the community page from the host's `communityUrl`; the Obsidian pane menu holds no Help.

## Amendment (2026-11-08): one Fields Panel, in the Fields popover or docked

Spec #1962, tickets #1963 to #1969. This amendment replaces the Fields column of the 2026-11-07 amendments, the Fields Picker of #1955, and the collapse-all button that trailed the field search.

The reader had two tools for one task: a Fields column with a tree of values in a wide view, and the Fields Picker, a flat list, in a narrow one. Resizing a view turned one into the other. There is now one Fields Panel with the same content and the same action at every width, in two presentations.

### The Fields popover and the docked panel

- The Fields action ("Fields", lucide `braces`) opens the Fields Panel. Unpinned, the panel stands in the Fields popover, at every width, in both hosts. The popover stands inset at the right edge of the view, as tall as the view less a small gap to its top, right and bottom edges (Obsidian's `--size-4-2`, 8 px on the web), and follows the view as it resizes. It is not modal: it has no scrim, nothing under it turns inert, and Tab is not trapped, so the editor and the Preview stay usable while it is open. Opening it puts focus in its field search. A second press, a press outside it, its close button, or Escape closes it; all but the press return focus to the action. An insert closes it and leaves focus to the editor after the inserted field; Shift on Insert keeps it open, with focus on that row's Insert button. The repair commands close it and move focus to the place they reveal.
- The reader pins the Fields Panel from its header. Pinned and shown, it docks as a column at the leading edge of the view, before the editor, the place the Fields column of the 2026-11-07 amendments had. It is not modal, stays open while the reader types and inserts, and has a resize edge, 240 to 480 px, which the keys and the size menus ("Resize fields") move too.
- The Fields action hides or shows the docked panel and keeps the pin; elsewhere it opens and closes the popover. The view action, the Obsidian pane menu's "Show fields" and the web View menu's "Show fields" press the same action. Where the view has no room, the pin is disabled with "Widen the view to pin" and a pinned panel notes "Pinned · opens over the editor in narrow views". Pinning moves focus into the docked panel's search; unpinning opens the popover. A docked panel that a restore or a wider view draws takes no focus. When a narrower view or a hide removes a focused docked panel, focus goes to the Fields action.
- The shared UI draws the Fields Panel (`FieldsPanel` in `@zotlit/workbench/ui`) and each host supplies the popover surface through its `fieldsAction` (`popover` and `popoverId`), as ADR 0044 asks: Obsidian's non-modal `PinnedPopover` inset in the view's box, and a Base UI popover with no backdrop on the web. The popover owns Escape, the outside press and focus back to the action.
- "Open template workbench" and Customize show the Preview; the Fields popover waits for the reader.

### State and placement

- The popover's open state is the shared model's `fieldsPanel`, `"open" | "closed" | "to-editor"`, view state that is never saved; `to-editor` closes it and leaves focus to the editor, as after an insert or a repair command.
- The saved panel state holds the Preview's facts and the Fields facts `pinned`, `hidden` (the Fields action hid the docked panel and kept the pin) and `width`. The Obsidian view saves them with its state; the web Workbench keeps them for the page's life. A Fields column that an older workspace saved has no pin, so it restores no docked panel.
- The placement rule's Fields part is `FieldsPlacement = "docked" | "popover" | "closed"`, with `canPin`. The Preview claims the side first; the pin works while the room it leaves keeps the editor 360 px beside a 240 px panel and its handle. A pinned, shown panel docks there; otherwise the panel stands in the Fields popover while the reader has it open. A popover that stands open as a wider view docks the panel closes into the dock, so a view that narrows again opens no popover by itself. No view size opens the popover.

### Rows and details

- A row shows a field's label and the sample Item's value on one line; a long value ends in "…". A click on the row, or Enter on the row selected with ↑/↓, shows or hides its details; focus stays in the search. Hover opens nothing and moves no layout. The row's Insert button (`text-cursor-input`, shown on hover, focus or selection), or Mod+Enter, inserts the field.
- The details show the full value, the template path, and "In your note" with the snippet and its result, plus Insert and Copy. The result follows the same rules as the snippet (`snippetResult` beside `renderSnippet`). Insert and Copy close the details, in the docked panel too, and announce "Inserted …" or "Copied …". A press outside the details and their row closes them. Escape closes the details, then clears the search, then closes the Fields popover; in the docked panel it stops after the search.
- In a view at least 600 px wide, the details are a nested popover beside the Fields popover or the docked panel, level with the row: a `PinnedPopover` in Obsidian and a nested Base UI popover on the web. In a narrower view, they are a bar of fixed height at the foot of the panel. This choice reads the view size the shared model holds, not a container query, because the Obsidian popover lives on the document body, outside the view.
- The Fields popover and the details popover keep Mod+Enter from Obsidian's hotkeys (the `pageKeys` option of `PinnedPopover`); the docked panel needs nothing.

### Sections

- Each section header shows the section icon, the label, the count of its top-level fields and a chevron at the right end, and stays at the top while its section scrolls. A click collapses or expands the section. "Collapse all sections" and "Expand all sections" sit in the panel header, before the pin. A search opens every section with a match.
- A label starts at the section icon's left edge; a nested field's label stands a little in, behind a thin guide line. The standalone Template Data Explorer shares the section header, and keeps its own row layout.

### Lists

- The Fields Panel shows a list field by its shape (`lists: "shape"` on the display tree): its item count and every item on one line. A list of records opens to one row for each property its items have, with that property's value for every item, and no row for one item's index. A list of plain values does not open. The standalone Template Data Explorer keeps its index rows, because Explore annotation there reads an annotation's index; in the Fields Panel, the Annotations row's menu explores the view's chosen annotation.
- The Template Snippets for a list and for a list property never name an index. Joined puts the items in one line (`join`, or `map` and `join`), offered where every item reads as text; loop puts each item on its own Markdown list line (`- `), and is always offered. This changes the loop body for both explorers: before, it repeated the item with no separator. The details offer the choice as "In one line" / "Each item"; the row's Insert uses the first form offered. One module (`explorer/list-items.ts`) decides whether items read as text and which property a list line shows, for the tree preview and the snippets alike.

### Preview header row

- The Preview Panel's header row (heading, caption, "File name: …") is sticky at the top of its scroll area, beside and under the editor, with scroll padding so a focused control stays clear of it. One shared component (`PreviewFilenameLabel`) draws the file name in both hosts.

## Amendment (2026-11-09): every open lands in the Workbench window

Spec #1962. This amendment replaces "A new view shows neither" in the Decision and the compact-editor open of ADR 0045.

- One function, `openTemplateWorkbench` (`views/template-workbench/open.ts`), opens a Template Document in the Workbench for every route: commands, file menus, the Markdown header action, the settings rows, the recovery notice, the Customize flow's Obsidian side and the `import-profile` link. It reveals the window that already holds the document. An open that starts from a leaf in a Workbench window (Open as Markdown and back, Edit partial, Extract to partial, the citation text from the pane menu) opens in that window: in the leaf, or in a new tab or split beside it. A Workbench leaf that an older workspace saved in the main window moves into a window of its own. Otherwise the open makes a new window. Every open shows the Preview.
- One command, "Open template workbench" (`open-template-workbench`), opens the active Profile, Citation Template, Shared Partial, or the Profile of the active Literature Note with its Item and the note to update. The file menu and the Markdown header action carry the same entry. "Switch to template workbench view", the second "Open template workbench" command (`customize-profile`), "Customize this note's template" (`customize-note-template`) and the pane menu's "Open template workbench" are gone. The pane menu's citation entry takes the command's name, "Customize citation text". The web Workbench launch and the settings' Customize chooser stay.
- The `import-profile` link's `paneType` no longer picks a pane for the imported Profile.
