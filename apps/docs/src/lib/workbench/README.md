# Template Workbench — web host

This directory owns the page layout, browser storage, and the bridge client wiring.
Editing rules, slice editors, the document model, the Explorer, the bridge contract, and
render scheduling live in `@zotlit/workbench` — read its
[README](../../../../../packages/workbench/README.md) first.

## Shell and bundle

[`src/routes/workbench.tsx`](../../routes/workbench.tsx) is a prerendered static shell, so
`/workbench` stays off the `run_worker_first` list and costs no Worker invocation. The shell
paints [`frame.tsx`](frame.tsx) as a skeleton — the same frame, toolbar, tab strip, and result
header the live page renders, every control inert — and starts the editor bundle's `import()`
when the route module evaluates in the browser, ahead of hydration. The frame module reaches
the shell, so it imports React, the shared Workbench UI, the site's messages, the UI kit,
icons, the web theme, and the connection bar only.

The bundle in this directory mounts in the same frame. [`reading-view.tsx`](reading-view.tsx),
which carries the Markdown parser stack, arrives behind it once a render has answered:
[`result-sheet.ts`](result-sheet.ts) holds the one `React.lazy` binding every pane that shows a
rendered note reads, so no static edge pulls the stack back into the editor chunk, and the
shared tree's `property-list.tsx` holds the property grid the Properties tab reads without it.

## The shared tree

The tab strip, the editor toolbar, the Problems area, and the editor panes are the headless
`@zotlit/workbench/ui` tree ([ADR 0044](../../../../../docs/adr/0044-workbench-ui-is-headless-and-hosts-own-the-look.md)):
[`theme.tsx`](theme.tsx) hands it the site's Tailwind classes per part and Lucide icons, and
[`host.tsx`](host.tsx) binds its host adapter — menu, dialog, confirm, suggester, hover card —
to Base UI, with the status line for a notice, the page's own renderer, the Item Snapshot's
names for a match, and browser storage for a preference. The shared tree paints inert outside
`WorkbenchEditorProvider`, which is how the skeleton shows it.

## Module ownership

One module owns each surface, and each says what it owns at its head:

| Module | Owns |
| --- | --- |
| [`workbench.tsx`](workbench.tsx) | Page layout, header menu, what a tab or mode change does beyond the Workbench model, slice routing, the `{{` popup, problem navigation |
| [`page-model.ts`](page-model.ts) | The web Workbench on the Workbench model: the chosen Item's one read, the connection's state, the page layout and the replacement a dirty draft holds back, hydration opening, the dependency and citation-style re-reads, and the page's commands |
| [`runtime.tsx`](runtime.tsx) | The page runtime: one atom runtime over every service below and the Local Bridge client (`@zotlit/workbench/bridge`) in the page's one atom registry, created with the page and disposed when it closes, and the one bridge React and CodeMirror reach the services through |
| [`workbench-connection.ts`](workbench-connection.ts) | The Workbench Connection service: the launch-fragment code exchange, hydration, the dependency and citation-style re-reads, Save with revision reconciliation, disconnect, and the connection Scope that Disconnect closes |
| [`use-workbench-connection.ts`](use-workbench-connection.ts) | The page's view of the Workbench Connection: its state and the reader's connection actions |
| [`rendering.ts`](rendering.ts) | The Rendering service: the render the host hands the Workbench, and the `Temporal` load |
| [`draft-keeper.ts`](draft-keeper.ts) | The baseline a draft is measured against, the autosave keyed by document reference, the restore prompt, as atoms of the page |
| [`sample-bar.tsx`](sample-bar.tsx) | The paper the page is shown against, and whether it is a Sample Item, the connection's own, or retained work |
| [`connection-bar.tsx`](connection-bar.tsx) | The connection status line |
| [`field-list.tsx`](field-list.tsx) with [`fields.ts`](fields.ts) | The field column |
| [`handoff.tsx`](handoff.tsx) with [`unsupported.ts`](unsupported.ts) | The handoff screen for a Profile this host cannot run |
| [`transfer.ts`](transfer.ts), [`annotation-mark.ts`](annotation-mark.ts), [`reading-view.tsx`](reading-view.tsx) | Import and download, the Transfer service (clipboard, Open in Obsidian, a picked file), the annotation mark, the rendered note |

## Rulings that sit in no single file

- Rendering runs on the page's own thread in [`render.ts`](render.ts). The Rendering service
  in [`rendering.ts`](rendering.ts) loads the `Temporal` polyfill once for a runtime that has
  none, and each render waits for that load (ADR 0045).
- Every asynchronous step of the page is an Effect on the page runtime, in the page's one
  atom registry: a read is an atom and a gesture is a command of
  [`page-model.ts`](page-model.ts) or of the Workbench model, and a host member reaches the
  services through the bridge's `provide`. One read of the chosen Item feeds every surface
  and the one render the editor and the result share; a new choice interrupts the read it
  replaces. A read that belongs to one connection runs in that connection's Scope, so
  Disconnect stops it; closing the page disposes the registry and stops everything.
- The page lays out the pane, the result and the Fields popover with the shared panels of
  `@zotlit/workbench/ui`, as the Template Workbench View in Obsidian does, so both hosts share
  one layout. The page measures its frame with a `ResizeObserver` into the view-size atom
  the placement reads; page tests report the frame's size through that observer, since their
  document lays nothing out. A new page shows `PAGE_PANELS` from [`frame.tsx`](frame.tsx),
  which the skeleton also paints; the panel state lives with the page and is not saved.
- [`reading-view.tsx`](reading-view.tsx) is the only module that reads the parser packages'
  node types, each pinned to an exact version, so a package swap stays inside that file.
- `@zotlit/workbench` names a problem by code while the shared tree's `problemText` and
  `diagnosticText` in `@zotlit/workbench/ui` write the words once for both hosts, so a new core
  code needs a new `workbench_*` message in the root catalog.

## In dev

The dev server reads `@zotlit/workbench` from its source through the package's `development`
export condition, so an edit there hot-updates through the page's React boundary with the
editor's state kept and needs no `tsdown --watch`; `@zotlit/templates` and `@zotlit/db` stay on
their built output. `optimizeDeps.entries` in [`vite.config.ts`](../../../vite.config.ts) names
the Workbench module, so the dependency scan finds CodeMirror, the Lezer parsers, the template
engines, and the reading view's parser stack before the first request instead of re-optimizing
round by round. Component modules here export components alone — `unsupported.ts` and
`annotation-mark.ts` hold what `handoff.tsx` and the annotation pane used to export beside
theirs — so Fast Refresh accepts each one in place.

## Tests

Each suite's name says what it pins; `apps/docs/AGENTS.md` → Verification maps them.
The control vocabulary in [`WORKBENCH-DESIGN.md`](../../../WORKBENCH-DESIGN.md) is enforced by
[`design.test.ts`](design.test.ts).
