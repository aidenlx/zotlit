# View migration prototype: Effect Atom vs zustand vs jotai

Follow-up to #1710 (retire the `plain.ts` adapters). Branch `proto/view-reactivity`,
based on `refactor/plain-15c-annotation-reads` (#1783), the stack tip of the
service migration.

## Question

What should the seam be where a React (Preact) Obsidian view reads Effect services?
The view must read a value from a service `Stream` or `SubscriptionRef`, re-render
when it changes, enter Effect from a handler, and stop cleanly.

## Lab

`apps/obsidian/src/views/reactivity-lab/`, registered only in dev builds
(`zotlit:open-reactivity-lab`). One mini Cited By, rendered three times from the
same panel and the same service Streams (`source.ts`). Only the state glue
changes between tabs.

Script per tab (in `WALK.md` beside this file; run in Obsidian 1.14.4, Preact runtime):
active note → key, rename (same key, new path), fast note switch, setting write
with pending, one-shot async read, filter and collapse (view-local), unmount,
two leaves, plugin disable while notes switch.

## Results (measured in the running app)

| Check | Effect Atom | zustand | jotai |
|---|---|---|---|
| Works under Preact compat | yes | yes | yes |
| Rename does not resubscribe | yes | yes | yes |
| Fast switch A→B→C→A opens | 1 | 1 | 0–1 |
| Stale-callback guard in view code | not needed | not needed (Stream `switchMap`) | not needed |
| Setting write: pending + result | yes (`AsyncResult.waiting`) | yes (hand-rolled) | yes (hand-rolled) |
| Unmount: live subs / late callbacks | 0 / 0 (closes after idle TTL, ~0.5 s) | 0 / 0 | 0 / 0 |
| **Two leaves, same note: live subs** | **1 (shared registry)** | 2 | 2 |
| Per-leaf view state separate | yes (`ScopedAtom`) | yes (store per tab) | yes (store per tab) |
| Plugin disable mid-switch: live / late / errors | 0 / 0 / none | 0 / 0 / none | 0 / 0 / none |
| Mount churn (open, close, open) | yes without `defaultIdleTTL`; gone with `defaultIdleTTL: 400` (isolated: removing only the TTL brings it back) | none | none |
| Glue lines per view | 57 | 91 | 111 |
| Glue paid once | `edge.ts` 44 per plugin, atoms 38 per service | — | — |
| New dependencies | `@effect/atom-react`, `scheduler` | none (in repo) | `jotai` |

## Design read (codebase-design vocabulary)

The behaviour is the same in all three. The choice is about the **interface** a view
author must learn at the seam, and where lifecycle lives.

```text
                      what the view author must know
Effect Atom   useAtomValue(serviceAtom) · useAtomSet(command) · <ViewRegistry>
              ── behind the seam: subscribe/stop, key switching, pending/failure,
                 sharing across leaves, Effect context, teardown
zustand       store shape · connect() with N subscribe calls and their stops ·
              setState glue · Exit → value · pending flags · useEffect lifecycle
jotai         atoms · Stream→observable adapter · Exit → value · pending atoms ·
              store per root  (two async models: Promise and Effect)
```

- **Effect Atom is the deep module.** A small interface hides the whole lifecycle.
  Deletion test: delete `edge.ts` and the registry seeding, idle TTL and context
  wiring reappear in every view. Service atoms are written once and serve N views
  (leverage). A change to how a service is read lands in one atom (locality).
- **The seam is real.** Two adapters fit it: the plugin context in production,
  and a registry seeded with a test Layer (`initialValues`) in tests. A view test
  then crosses the same interface as the view.
- **zustand is a shallow pass-through for service state.** The store only caches
  Stream values, and lifecycle sits in each view. It still earns its keep for
  view-local state, which is its role in the 32 files that use it today.
- **jotai** reproduces the Atom graph but adds an adapter seam (Stream→observable)
  and a second async model. No gain over Effect Atom here.
- **Plain baseline** (the #1710 sketch, "zustand/jotai minus the library"; a sketch, not run in the lab):

  ```ts
  function useStream<A>(stream: Stream.Stream<A, never, R>, fallback: A): A {
    const ref = useRef(fallback);
    const subscribeTo = useCallback(
      (notify: () => void) =>
        subscribe(runtime, stream, (value) => { ref.current = value; notify(); }),
      [stream],
    );
    return useSyncExternalStore(subscribeTo, () => ref.current);
  }
  ```

  It needs no new dependency and gives the same per-view result as zustand. It has no
  derived graph, no sharing across leaves, and no command pending/failure model,
  so every view still writes those by hand.

## Verdict

Use Effect Atom (`effect/reactivity` + `@effect/atom-react`) as the view seam
for service state and commands:

1. A deep module `lib/view-atoms.ts`: `viewRuntime` (an `Atom.runtime` over the
   plugin's services, seeded per registry), `held(stream, fallback)`, and
   `ViewRegistry`.
2. One registry for the plugin's lifetime, disposed after the views detach and
   before the services stop. Tested order: the lab disposes it through
   `plugin.register`, which Obsidian runs after `onunload` and after the view
   leaves detach. A scoped Layer in `pluginLayer` is the tidier seat but
   disposes earlier, during `onunload`, while views can still be mounted.
   Untested: run the same disable walk before you choose that seat.
3. Static atoms next to each service (`services/<name>/atoms.ts`): a state atom
   per state member, a `viewRuntime.fn` per command.
4. Keep view-local state owned by the view. The lab shows `ScopedAtom` keeps
   per-leaf state separate, but a `ScopedAtom` instance is born inside React
   context, so the `ItemView` class cannot reach it for `getState()` /
   `setState()` layout persistence (Cited By's `LAYOUT_KEYS`). Untested. Two
   ways that fit: the existing view-owned zustand store, or a writable atom
   that the `ItemView` creates, passes down, and reads with `registry.get` /
   `registry.set` for layout state.
5. Start with settings (52 consumers), as #1710 already plans.

Costs to accept:

- `effect/reactivity` and atom-react are marked `@stability unstable`. The repo
  already pins `effect` exactly.
- Preact needs `defaultIdleTTL` (isolated in the lab), so a subscription closes
  up to ~0.4 s after unmount. Cause: Preact runs `useSyncExternalStore`'s
  subscribe after paint, later than the registry's removal task for a node read
  during render.
- The seeded services atom must be `Atom.keepAlive`. Without it, the seed is lost
  when the node goes idle (seen in the lab: every atom fell back to the
  `Layer.die` default).
- `Atom.make<T>(value)` with an explicit type argument resolves to the wrong
  overload. Write `Atom.make(value as T)`.
- `AsyncResult` on every Stream atom; `held` absorbs it for state.
- The repo lint (`effecttsgo(unstable-api-usage)`) warns at every
  `effect/reactivity` and atom-react call site. A second reason to keep those
  calls inside `lib/view-atoms.ts` and the `atoms.ts` files: views would then
  import only the module's own hooks, and the warnings stay in one place.
