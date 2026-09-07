# Workbench UI is headless and the hosts own the look

The web Template Workbench and the Obsidian Profile Editor present the same tabs, panes, rows, and result view over one Profile document. Decided in the Profile Editor grilling on map #835 (2026-09-07): the two hosts mount one shared, headless component layer, the Workbench UI, exported as `@zotlit/workbench/ui` with React as a peer dependency, and everything in the tree that a user sees as colour, spacing, or type comes from the host. The shared tree renders structure and behaviour only: each component marks its parts with `data-part` and its state with `data-state` attributes, and an optional slot class map, supplied once through a theme context, lets a host attach its own class names per part. The theme also resolves icons by role through a host-supplied renderer. Call sites pass no classes. Anything that opens over the page is the host's: menus, dialogs and confirms, suggesters and pickers, tooltips and hover cards, and notices arrive through a host adapter in context, so Obsidian shows its own `Menu`, `Modal`, and `SuggestModal` and the web shows Base UI. Anything that lives in the page is shared DOM. The shared tree compiles its own Paraglide facade from the root `messages/` catalog under a `workbench_*` namespace, holds view state in a zustand vanilla store per editor instance, and stays inside the `preact/compat` surface because Obsidian's runtime is Preact.

## Considered options

- **Shared headless stores and hooks, host-written JSX**: keeps every host free to lay out its own markup, and duplicates every row, tab, and list twice; the duplication is the failure this decision prevents.
- **Shared styled components with a Tailwind theme per host**: one look forced on both hosts; Obsidian's preflight has to stay scoped under `.zt-root`, its utilities carry the `zt` prefix, and native Obsidian classes such as `clickable-icon` are what make a pane feel native, so the styles cannot be shared.
- **Portal controls in the shared tree**: a shared popup never looks like an Obsidian menu and never gets Obsidian's keyboard scopes.

## Consequences

- The web components are rewritten onto the headless tree with no behaviour change before any Obsidian UI exists; that rewrite is the first ticket of the spec and the proof of the DRY claim.
- The shared tree's tests run under both React and `preact/compat` in CI.
- The other `@zotlit/workbench` subpaths stay free of React.
