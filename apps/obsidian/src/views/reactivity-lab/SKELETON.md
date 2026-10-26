# Effect-native view skeleton (Cited By as the example)

PROTOTYPE (proto/view-reactivity). Pseudocode, not compiled. "Current" is
`src/views/cited-by/` on the `refactor/plain-15c-annotation-reads` stack.
"New" is the shape the Reactivity Lab walked (FINDINGS.md).

## Who owns what

| Concern | Current | New |
|---|---|---|
| Service reads | `PlainCitationIndex` adapter (`plain.ts`), callbacks | static atoms in `services/<name>/atoms.ts` over service Streams |
| Following the active note | view class: `workspace.on(...)` + `#followActiveNote` + key dedupe | `activeNoteAtom` → `activeKeyAtom` (equal key stops here) |
| Switching the subscription | `#stopObserving()` + `if (followed.indexedKey !== key) return` guard | the atom reads the key; a new key interrupts the old Stream |
| Previews | hand-built queue, `generations` map, `draining` flag | `previewAtom(path)` family; unread previews stop after the idle TTL |
| Commands | `actions.ts` closures over `app`, adapters and `store.setState` | `viewRuntime.fn` atoms; pending and failure in `AsyncResult` |
| Saved layout | zustand store slice + `LAYOUT_KEYS` + typeof checks | `model.layout` atom + Effect `Schema` decode |
| Memory-only UI state | same zustand store | `model.ui` atom |
| React plumbing | `CitedByStoreProvider` + `CitedByActionsContext` | `ViewRegistry` (plugin registry) + `ViewModelContext` |
| Lifetime | `register`, `registerEvent`, manual stops, `root.unmount` | `Component.register` for Obsidian hooks; atoms stop when unread |

## Files

```diff
 src/
 ├── lib/
+│   └── view-atoms.ts            # viewRuntime, held, ViewRegistry, makeViewRegistry
 ├── services/
 │   ├── plugin-layer.ts          # (later) registry as a scoped Layer, after the disable walk
 │   └── citation-index/
 │       ├── service.ts           # + citedBy(key): Stream, beside observeCitedBy
-│       ├── plain.ts             # adapter retires
+│       └── atoms.ts             # citedByActiveAtom, previewAtom, commands
 └── views/cited-by/
     ├── register.ts              # deps: { registry } instead of plain adapters
-    ├── store.ts                 # service cache + UI state + provider
-    ├── actions.ts               # imperative actions, preview queue
+    ├── model.ts                 # per-leaf atoms: layout (saved), ui (memory)
     ├── view.tsx                 # ItemView: the Obsidian adapter
     └── CitedBy.tsx              # hooks only
```

## 1. Wiring (zt-main / register)

```diff
 // zt-main.ts
-registerCitedByView(this, { app, citationIndex: services.citationIndex /* plain */ })
+const registry = makeViewRegistry(services.runtime)   // once per plugin
+this.register(() => registry.dispose())               // after views detach
+registerCitedByView(this, { registry })
```

```ts
// views/cited-by/register.ts — New
registerCitedByView(plugin, { registry }):
  plugin.registerView(TYPE, (leaf) => new CitedByView(leaf, registry))
  plugin.addCommand({ id: "show-cited-by", callback: () => openCitedByView(plugin.app) })
  plugin.addCommand({ id: "cited-by-toggle-search",            // a command on "this view"
    checkCallback: (checking) =>
      withActiveView(CitedByView, checking, (view) => view.toggleSearch()) })
```

## 2. Service side: a Stream member per state

```diff
 // services/citation-index/service.ts
-observeCitedBy(key, callback): Effect<() => void>     // consumer keeps the stop
+citedBy(key): Stream<CitedBySnapshot>                 // stop = interrupt
+  Stream.callback(queue =>
+    observe(key, snapshot => Queue.offerUnsafe(queue, snapshot))
+    + Effect.addFinalizer(stop))
```

## 3. The seam: lib/view-atoms.ts (one per plugin)

```ts
servicesLayer = Atom.keepAlive(Atom.make(() => Layer.die("not seeded")))
viewRuntime   = Atom.runtime(get => get(servicesLayer))   // plugin services, no 2nd graph

held(stream, fallback): Atom<A>                           // state Stream → plain value

makeViewRegistry(runtime):
  AtomRegistry.make({
    initialValues: [[servicesLayer, Layer.succeedContext(runtime.context)]],
    scheduleTask,                                         // atom-react's
    defaultIdleTTL: 400,                                  // Preact subscribes after paint
  })

ViewRegistry({ registry, children }) = <RegistryContext.Provider value={registry}>
```

## 4. Service atoms: services/citation-index/atoms.ts (once per service)

```ts
activeNoteAtom    = held(activeNote /* Workspace + Metadata + Vault rename */, null)
activeKeyAtom     = Atom.map(activeNoteAtom, n => n?.key ?? null)     // equal key: no rerun
citedByActiveAtom = viewRuntime.atom(get =>
                      get(activeKeyAtom) ? citedBy(key) : Stream.make(EMPTY))

previewAtom       = Atom.family((path) =>                             // was: queue + generations
                      viewRuntime.atom(readPreview(path)))           // AsyncResult per group

openSourceCommand = viewRuntime.fn((path, pane) => openLinkText(path, pane))
```

Writes go through the service's own Effect (`viewRuntime.fn`), never a raw
`SubscriptionRef`: that path validates and saves (setting-tab verdict).

## 5. Per-leaf model: views/cited-by/model.ts

```ts
SavedLayout = Schema.Struct({ searchVisible?, search?, moreContext?, sort? })

makeCitedByModel() = {
  layout: Atom.make({ searchVisible: false, search: "", moreContext: false, sort: DEFAULT }),
  ui:     Atom.make({ collapsed: [], expansions: {} }),      // memory only
}
holdModel(registry, model)  → release        // mount every model atom
readSavedLayout(state)      → Partial<Layout> // Schema.decodeUnknownOption
ViewModelContext / useCitedByModel()
```

## 6. ItemView: the Obsidian adapter

Current (`views/cited-by/view.tsx`, abridged):

```ts
class CitedByView extends ItemView {
  #store = createCitedByStore()                       // zustand: service data + UI
  #actions = createCitedByActions({ app, citationIndex, store })
  #followed; #stopObserving

  getState()  = layoutState(store.getState())
  setState(s) = store.setState({ ...typeof-checked fields of s })

  onOpen():
    root.render(<StoreProvider><ActionsContext><CitedBy/>)
    register(store.subscribe(changed layout → requestSaveLayout))
    registerEvent(workspace.on("active-leaf-change", followActiveNote))
    registerEvent(metadataCache.on("changed", file === active → followActiveNote))
    registerEvent(vault.on("rename", ...))
    followActiveNote()
  followActiveNote(file):
    key = itemKeyFromFrontmatter(...)
    if same key and path: return
    if same key: store.setState({ activePath }); return
    #stopObserving?.()
    store.setState({ key, path, snapshot: EMPTY, collapsed: [], expansions: {} })
    #stopObserving = citationIndex.observeCitedBy(key, snapshot => {
      if (#followed.indexedKey !== key) return          // stale guard
      store.setState({ snapshot })
    })
  onClose(): #stopObserving?.(); root.unmount()
}
```

New:

```ts
class CitedByView extends ItemView {
  readonly model = makeCitedByModel()
  #release = holdModel(registry, this.model)          // constructor: setState may come first

  constructor(leaf, registry):
    this.scope = new Scope(app.scope)                 // view keys; Obsidian pushes on focus
    this.scope.register(["Mod"], "f", () => (this.toggleSearch(), false))

  getState()  = { ...super.getState(), ...registry.get(model.layout) }
  setState(s) = registry.update(model.layout, l => ({ ...l, ...readSavedLayout(s) }))
  getEphemeralState()  = { scrollTop: contentEl.scrollTop }   // DOM-owned
  setEphemeralState(s) = contentEl.scrollTop = s.scrollTop

  onPaneMenu(menu):                                   // read now, write on click
    { sort } = registry.get(model.layout)
    for mode of SORT_MODES: menu.addItem(checked: mode === sort, onClick: setSort(mode))

  toggleSearch() = registry.update(model.layout, l => ({ ...l, searchVisible: !l.searchVisible }))

  onOpen():
    action = addAction("search", "Search", () => this.toggleSearch())
    register(registry.subscribe(model.layout, l => action.toggleClass("is-active", l.searchVisible),
                                { immediate: true }))
    register(registry.subscribe(model.layout, () => workspace.requestSaveLayout()))
    // memory-only state resets when the followed key changes:
    register(registry.subscribe(activeKeyAtom, () => registry.set(model.ui, EMPTY_UI)))
    root.render(<ViewRegistry registry><ViewModelContext value={model}><CitedBy/>)

  onClose(): root.unmount(); #release()
}
```

Gone from the class: the three `registerEvent` calls, `#followed`,
`#stopObserving`, the key dedupe and the stale guard. They live in
`activeNoteAtom` and `citedByActiveAtom`, once for every view.

## 7. React component

Current:

```tsx
function CitedBy() {
  const state   = useCitedByStore(s => s)             // one store: service + UI
  const actions = useCitedByActions()
  useEffect(() => actions.loadPreviews(state.snapshot.groups), [state.snapshot])
  return <Groups groups={actions.sortGroups(filter(state.snapshot.groups, state.search), state.sort)}
                 onOpen={actions.openSource} onToggle={actions.toggleGroup} />
}
```

New:

```tsx
function CitedBy() {
  const model     = useCitedByModel()
  const snapshot  = useAtomValue(citedByActiveAtom)   // service, shared across leaves
  const [layout, setLayout] = useAtom(model.layout)   // saved, per leaf
  const [ui, setUi]         = useAtom(model.ui)       // memory, per leaf
  const openSource = useAtomSet(openSourceCommand)
  return <Groups groups={sortGroups(filter(snapshot.groups, layout.search), layout.sort)}
                 onOpen={openSource} onToggle={path => setUi(toggleCollapsed(path))} />
}

function GroupPreview({ path }) {                     // was: loadPreviews queue
  return AsyncResult.match(useAtomValue(previewAtom(path)), {
    onInitial: () => <Skeleton/>, onFailure: () => <Unavailable/>, onSuccess: p => <Excerpt {...p}/> })
}
```

## 8. Tests

| Test | Current | New |
|---|---|---|
| Component | render with a fake zustand store and a fake actions object | render under a registry seeded with a test Layer (`initialValues`) |
| Service atoms | (none: logic sits in the view class) | `registry.get(citedByActiveAtom)` over a test Layer, no React |
| View class | fake `app` + store spies | fake registry: `getState`/`setState`, menu, action, Scope |
| End to end | `packages/e2e` | unchanged: it drives the app, not the shape |

## 9. Open before you build

- Registry seat: a scoped Layer in `pluginLayer` disposes the registry during
  `onunload`, before the views detach. The lab disposes it after. Run the
  disable walk before you move it.
- `view.scope` push on focus: not seen (no OS focus during the walk). Prove it
  with trusted input in an E2E case.
- `previewAtom` family and `Atom.family` keys: sketched, not walked.
