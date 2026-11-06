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
