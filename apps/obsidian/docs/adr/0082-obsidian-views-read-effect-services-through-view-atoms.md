# Obsidian views read Effect services through view atoms

An Obsidian view reads the plugin's Effect services through Effect Atom (`effect/reactivity`): atoms in one view registry, seeded with the service context, which the view and its React tree read and write. A view keeps its own state in a per-leaf model of writable atoms changed by pure transitions, runs its gestures as commands, and saves the workspace layout from a registry subscription. The Plain adapters, the zustand stores over them, and `bridge.subscribe` leave each view as it converts (#1710).

Proposed on 2026-10-27 with [#1812](https://github.com/aidenlx/zotlit/pull/1812), after the prototype on `proto/view-reactivity` compared Effect Atom, zustand and jotai as the bridge.

## Considered Options

- **zustand stores fed by `bridge.subscribe`** (rejected): what the views did. Each view wires its own subscriptions, generation counters and late-result guards, and a read cannot be interrupted when its leaf closes.
- **jotai over the bridge** (rejected): derived state and per-leaf atoms, but every Effect still crosses the bridge as a Promise, so interruption and the services' Streams stop at the seam.
- **Effect Atom over the service context** (chosen): an atom runs an Effect or a Stream with the services in scope, a dependency change interrupts the old run, a node no leaf reads stops its work, and one service Stream serves every leaf.

## Patterns

Each pattern names its reference. Copy the reference; it carries the details this list leaves out.

| Pattern | Reference |
|---|---|
| One registry for the plugin, a layer in the plugin's graph, seeded with `ViewServices` | `src/lib/view-atoms.ts`: `ViewRegistry`, `layerViewRegistry`, `makeViewRegistry`; `src/services/plugin-layer.ts` |
| One runtime for every view atom; no view builds its own | `src/lib/view-atoms.ts`: `viewRuntime` |
| A service Stream as an atom with a fallback, shared by every leaf | `src/lib/view-atoms.ts`: `held`; `src/services/note-index/atoms.ts`: `activeNoteAtom`; `src/services/zotero-reads/atoms.ts`: `zoteroRevisionAtom` |
| A narrow derived atom, so a change elsewhere does not re-run its readers | `src/services/note-index/atoms.ts`: `activeKeyAtom`; `src/views/template-data-explorer/model.ts`: `revision` in `makeExplorerModel` |
| An atom family keyed by an input, each member stopping when no leaf reads it | `src/services/citation-index/atoms.ts`: `citedByAtom`; `src/views/cited-by/atoms.ts`: `previewAtom` |
| A read that re-runs on a dependency and interrupts the read it replaces | `src/views/cited-by/atoms.ts`: `previewAtom`; `src/views/template-data-explorer/model.ts`: `loaded` |
| A load that shows something at once, then the read's result | `src/views/template-data-explorer/model.ts`: `loadExplorerData` |
| A shared limit on concurrent reads across leaves | `src/views/cited-by/atoms.ts`: `reads` |
| A service the views read, as one tag over the services it is built from | `src/services/template-workbench/data-reads.ts`: `TemplateDataReads`, `layerTemplateDataReads` |
| A per-leaf model: writable atoms, held from the view's constructor to `onClose` | `src/views/annot-view/model.ts`: `makeAnnotViewModel`, `holdAnnotViewModel`; `src/views/template-data-explorer/model.ts`: `makeExplorerModel`, `holdExplorerModel` |
| Pure transitions `(state) => state`, returning the same state when nothing changes | `src/views/annot-view/model.ts`: `setFollowMode`, `pinItem`, `unpin`; `src/views/template-data-explorer/model.ts`: `setTarget`, `toggleNode` |
| Saved and ephemeral view state decoded with Schema | `src/views/template-data-explorer/model.ts`: `readSavedExplorer`, `readEphemeralExplorer` |
| Layout save, view title and view action sync from a registry subscription | `src/views/annot-view/view.tsx`: `onOpen`; `src/views/template-data-explorer/view.tsx`: `onOpen` |
| A command that needs no leaf, shared by every leaf | `src/views/cited-by/atoms.ts`: `openSourceCommand`, `openOccurrenceCommand` |
| A command owned by one leaf, interrupted when that leaf closes | `src/views/template-data-explorer/atoms.ts`: `makeExportTemplateDataCommand` |
| Palette commands with `checkCallback` that read the registry | `src/views/annot-view/register.ts`: `addFollowModeCommands` |
| The React tree reads atoms through the registry provider and a model context | `src/lib/view-atoms.ts`: `ViewRegistryProvider`; `src/views/template-data-explorer/model.ts`: `ExplorerModelContext`, `useExplorerModel` |
| A test host: the registry over in-memory Obsidian sources and service fakes the test drives | `src/views/cited-by/__fixtures__.ts`: `makeCitedByHost`; `src/views/template-data-explorer/__fixtures__.ts`: `makeExplorerHost`; `src/lib/__fixtures__/view-atoms.ts`: `layerUnreadViewServices`, `scopedViewRegistry` |

## Pitfalls

Each of these broke the first migrations.

- **Scheduler.** `makeViewRegistry` schedules atom work with `scheduleBrowserTask` (`src/lib/browser-scheduler.ts`). React's `scheduleTask` from `@effect/atom-react` picks `setImmediate` in Electron and can starve the renderer.
- **Commands run while held.** A `viewRuntime.fn` command runs only while its atom is mounted: the view holds it with `registry.mount` and calls it with `registry.set`. A command one leaf owns is made per leaf; a shared command started from a second leaf interrupts the first leaf's run.
- **Writable atoms live while held.** An unmounted writable atom drops its state. A view holds its model from the constructor, because Obsidian calls `setState` before `onOpen`, and again with `??=` in `onOpen` after a close.
- **Failure before the previous value.** `AsyncResult.value` returns the previous success from a Failure. Check `AsyncResult.isFailure` first when a failed read must show.
- **Interruptible reads.** `Effect.tryPromise` interrupts its Promise only when the try function takes the `signal` parameter. A test fake that ignores the signal holds a shared permit after its leaf closes.
- **Stream atoms.** A Stream atom's error type includes `NoSuchElementError`, and its result stays `waiting` until the Stream ends. `Stream.scan` takes its initial value as a function.
- **Service methods.** Each method of a view service's tag is `Effect.fn("<Tag>.<method>")`, as for every Effect service.
- **Test timing.** A test waits on a completion signal: a model's `loaded` result no longer `waiting`, the previews out of `loading`, a fake's `cancelled` list. Counted `yieldToMain` turns break when the scheduler changes.
- **Test registries.** A test makes its registry with `makeExplorerHost`, `makeCitedByHost` or `scopedViewRegistry`. Each sets the zero idle delay with a 1 ms timeout resolution, and a zero resolution makes every node timeout `NaN`. `scopedViewRegistry` disposes the registry with the test's scope, a failed assertion included.
- **Reading after release.** `registry.get` on a released atom builds its node again and keeps it alive. A test checks a closed leaf through what its close interrupted, not through its state.
- **Unread services.** A test host merges `layerUnreadViewServices` first, so its registry context holds every `ViewServices` tag; a service the test reads, merged after it, takes its place.

## Migrating a view

1. Move the view's per-leaf state into a model with transitions; delete its store.
2. Replace each `bridge.subscribe` and Plain read with an atom over the service tag. A service the views lack joins `ViewServices` and `layerViewRegistry`'s inputs.
3. Run each gesture that calls a service as a command.
4. Save the layout and sync the title and actions from a registry subscription.
5. Thread `registry: ViewRegistryHandle` from `zt-main.ts`, and drop the deps the view no longer uses.
6. Test through a host that drives the services, and walk the view in the app.
7. Add the view's directory to the view-atom import bans in `apps/obsidian/oxlint.config.ts`.

## Consequences

- A view's reads stop when its leaf closes, and one service Stream serves every leaf.
- `effect/reactivity` and `@effect/atom-react` are unstable APIs; `effecttsgo/unstable-api-usage` reports each use, and an Effect upgrade may change them.
- Views that have not converted keep their stores and the bridge until their own migration.
