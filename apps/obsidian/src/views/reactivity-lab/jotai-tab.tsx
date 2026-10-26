// PROTOTYPE (proto/view-reactivity) — throwaway. Candidate C: jotai atoms,
// with Effect Streams adapted to jotai's observable atoms through
// lib/effect-stream `subscribe`.
import { Exit, Stream } from "effect";
import {
  Provider,
  atom,
  createStore,
  useAtom,
  useAtomValue,
  useSetAtom,
} from "jotai";
import { atomWithObservable } from "jotai/utils";
import { useMemo, useState } from "react";

import { subscribe } from "@/lib/effect-stream";
import type { CitedBySnapshot } from "@/services/citation-index/service";

import { Panel, toggled } from "./panel";
import {
  EMPTY_SNAPSHOT,
  activeNote,
  atTrigger,
  citedBy,
  openNote,
  readCitedByOnce,
  toggleAtTrigger,
} from "./source";
import type { ActiveNote, LabServices } from "./source";
import type { LabRuntime } from "./zustand-tab";

/** A Stream as the observable jotai subscribes to while an atom is mounted. */
function observe<A>(
  runtime: LabRuntime,
  stream: Stream.Stream<A, never, LabServices>,
) {
  return {
    subscribe: (observer: { next: (value: A) => void }) => ({
      unsubscribe: subscribe(runtime, stream, (value) => observer.next(value)),
    }),
  };
}

function makeAtoms(runtime: LabRuntime) {
  const note = atomWithObservable<ActiveNote | null>(
    () => observe(runtime, activeNote),
    { initialValue: null },
  );
  // Derived; jotai skips dependents when the key is Object.is-equal.
  const key = atom((get) => get(note)?.key ?? null);
  // Reading `key` makes jotai rebuild the observable on a key change and
  // unsubscribe the old one.
  const snapshot = atomWithObservable<CitedBySnapshot | null>(
    (get) => {
      const followed = get(key);
      return observe(
        runtime,
        followed ? citedBy(followed) : Stream.make(EMPTY_SNAPSHOT),
      );
    },
    { initialValue: null },
  );
  const setting = atomWithObservable<boolean | null>(
    () => observe(runtime, atTrigger),
    { initialValue: null },
  );
  // Async writes: hand-rolled pending/result state beside an action atom.
  const togglePending = atom(false);
  const toggle = atom(null, async (_get, set) => {
    set(togglePending, true);
    await runtime.runPromiseExit(toggleAtTrigger);
    set(togglePending, false);
  });
  const once = atom("");
  const readOnce = atom(null, async (_get, set, k: string) => {
    set(once, "loading…");
    const exit = await runtime.runPromiseExit(readCitedByOnce(k));
    set(once, Exit.isSuccess(exit) ? exit.value : "failed");
  });
  return {
    note,
    snapshot,
    setting,
    togglePending,
    toggle,
    once,
    readOnce,
    search: atom(""),
    collapsed: atom<ReadonlySet<string>>(new Set<string>()),
  };
}

type LabAtoms = ReturnType<typeof makeAtoms>;

export function JotaiTab(props: { readonly runtime: LabRuntime }) {
  const atoms = useMemo(() => makeAtoms(props.runtime), [props.runtime]);
  // One store per mounted tab: per-leaf isolation is an explicit choice.
  const [store] = useState(() => createStore());
  return (
    <Provider store={store}>
      <JotaiPanel atoms={atoms} runtime={props.runtime} />
    </Provider>
  );
}

function JotaiPanel(props: {
  readonly atoms: LabAtoms;
  readonly runtime: LabRuntime;
}) {
  const { atoms } = props;
  const note = useAtomValue(atoms.note);
  const snapshot = useAtomValue(atoms.snapshot);
  const setting = useAtomValue(atoms.setting);
  const togglePending = useAtomValue(atoms.togglePending);
  const toggle = useSetAtom(atoms.toggle);
  const once = useAtomValue(atoms.once);
  const readOnce = useSetAtom(atoms.readOnce);
  const [search, setSearch] = useAtom(atoms.search);
  const [collapsed, setCollapsed] = useAtom(atoms.collapsed);
  return (
    <Panel
      flavor="jotai"
      note={note}
      snapshot={snapshot}
      search={search}
      onSearch={setSearch}
      collapsed={collapsed}
      onToggleGroup={(path) => setCollapsed((set) => toggled(set, path))}
      atTrigger={setting}
      togglePending={togglePending}
      onToggleAtTrigger={() => void toggle()}
      once={once}
      onReadOnce={() => note?.key && void readOnce(note.key)}
      onOpen={(path) => void props.runtime.runPromiseExit(openNote(path))}
    />
  );
}
