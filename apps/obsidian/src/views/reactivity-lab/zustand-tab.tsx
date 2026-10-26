// PROTOTYPE (proto/view-reactivity) — throwaway. Candidate B: the incumbent
// zustand store, fed by Effect Streams through lib/effect-stream `subscribe`.
// Composition (key dedupe, switching) stays in Stream operators.
import { Exit } from "effect";
import type { ManagedRuntime } from "effect";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { subscribe } from "@/lib/effect-stream";
import type { CitedBySnapshot } from "@/services/citation-index/service";

import { Panel, toggled } from "./panel";
import {
  activeNote,
  atTrigger,
  citedByOfActive,
  openNote,
  readCitedByOnce,
  toggleAtTrigger,
} from "./source";
import type { ActiveNote, LabServices } from "./source";

export type LabRuntime = Pick<
  ManagedRuntime.ManagedRuntime<LabServices, never>,
  "runFork" | "runPromiseExit" | "scope"
>;

interface LabState {
  note: ActiveNote | null;
  snapshot: CitedBySnapshot | null;
  atTrigger: boolean | null;
  togglePending: boolean;
  once: string;
  search: string;
  collapsed: ReadonlySet<string>;
}

function makeStore(runtime: LabRuntime) {
  const store = createStore<LabState>(() => ({
    note: null,
    snapshot: null,
    atTrigger: null,
    togglePending: false,
    once: "",
    search: "",
    collapsed: new Set(),
  }));
  const actions = {
    toggle: async () => {
      store.setState({ togglePending: true });
      await runtime.runPromiseExit(toggleAtTrigger);
      store.setState({ togglePending: false });
    },
    readOnce: async (key: string) => {
      store.setState({ once: "loading…" });
      const exit = await runtime.runPromiseExit(readCitedByOnce(key));
      store.setState({ once: Exit.isSuccess(exit) ? exit.value : "failed" });
    },
    open: (path: string) => void runtime.runPromiseExit(openNote(path)),
    /** Start the service feeds; returns their stop. */
    connect: () => {
      const stops = [
        subscribe(runtime, activeNote, (note) => store.setState({ note })),
        subscribe(runtime, citedByOfActive(activeNote), (snapshot) =>
          store.setState({ snapshot }),
        ),
        subscribe(runtime, atTrigger, (value) =>
          store.setState({ atTrigger: value }),
        ),
      ];
      return () => stops.forEach((stop) => stop());
    },
  };
  return { store, actions };
}

export function ZustandTab(props: { readonly runtime: LabRuntime }) {
  // One store per mounted tab: per-leaf isolation by construction.
  const [{ store, actions }] = useState(() => makeStore(props.runtime));
  useEffect(() => actions.connect(), [actions]);
  const state = useStore(store);
  return (
    <Panel
      flavor="zustand"
      note={state.note}
      snapshot={state.snapshot}
      search={state.search}
      onSearch={(search) => store.setState({ search })}
      collapsed={state.collapsed}
      onToggleGroup={(path) =>
        store.setState((s) => ({ collapsed: toggled(s.collapsed, path) }))
      }
      atTrigger={state.atTrigger}
      togglePending={state.togglePending}
      onToggleAtTrigger={() => void actions.toggle()}
      once={state.once}
      onReadOnce={() =>
        state.note?.key && void actions.readOnce(state.note.key)
      }
      onOpen={actions.open}
    />
  );
}
