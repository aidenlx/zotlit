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
| [`workbench.tsx`](workbench.tsx) | Page layout, header menu, the editor's view store and what a tab or mode change does beyond it, slice routing, the `{{` popup and the narrow sheet, problem navigation |
| [`use-workbench-connection.ts`](use-workbench-connection.ts) | The `LocalBridgeClient` state machine: the launch-fragment code exchange, hydration, the citation-style refetch, Save with revision reconciliation, disconnect |
| [`use-workbench-draft.ts`](use-workbench-draft.ts) | The baseline a draft is measured against, the autosave keyed by document reference, the restore prompt |
| [`sample-bar.tsx`](sample-bar.tsx) | The paper the page is shown against, and whether it is a Sample Item, the connection's own, or retained work |
| [`connection-bar.tsx`](connection-bar.tsx) | The connection status line |
| [`field-list.tsx`](field-list.tsx) with [`fields.ts`](fields.ts) | The field column |
| [`handoff.tsx`](handoff.tsx) with [`unsupported.ts`](unsupported.ts) | The handoff screen for a Profile this host cannot run |
| [`transfer.ts`](transfer.ts), [`annotation-mark.ts`](annotation-mark.ts), [`reading-view.tsx`](reading-view.tsx) | Import and download, the annotation mark, the rendered note |

## Rulings that sit in no single file

- Rendering runs on the page's own thread in [`render.ts`](render.ts), which awaits the
  `Temporal` polyfill for a runtime that has none (ADR 0045).
- The layout folds twice — under 780 px the pane fills the screen with the result on a tab of
  its own, and under 1180 px the field column becomes the sheet the pane's **Add a field**
  button opens, because three columns inside that width leave the editing pane too narrow to
  write in (#958).
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
