// Per-host Query View state, held in the plugin registry, and its pure transitions.
import * as Atom from "effect/reactivity/Atom";
import { useMemo, useSyncExternalStore } from "react";

import type { ViewRegistryHandle } from "@/lib/view-atoms";

import type { QueryView, QueryViewState } from "./view";

export const INITIAL_QUERY_STATE: QueryViewState = {
  file: null,
  view: null,
  problems: [],
  phase: "idle",
  results: null,
  failure: null,
  saveFailed: false,
  defaults: {},
};

export const makeQueryViewModel = () => ({
  state: Atom.make(INITIAL_QUERY_STATE),
});
export type QueryViewModel = ReturnType<typeof makeQueryViewModel>;

export const holdQueryViewModel = (
  registry: ViewRegistryHandle,
  model: QueryViewModel,
): (() => void) => registry.mount(model.state);

export const patchQueryState =
  (
    patch:
      | Partial<QueryViewState>
      | ((state: QueryViewState) => Partial<QueryViewState>),
  ) =>
  (state: QueryViewState): QueryViewState => {
    const next = typeof patch === "function" ? patch(state) : patch;
    return Object.entries(next).every(([key, value]) =>
      Object.is(state[key as keyof QueryViewState], value),
    )
      ? state
      : { ...state, ...next };
  };

/** The existing host interface, backed by the model rather than a second state store. */
export function queryStateHandle(
  registry: ViewRegistryHandle,
  model: QueryViewModel,
) {
  function setState(
    patch:
      | QueryViewState
      | Partial<QueryViewState>
      | ((state: QueryViewState) => QueryViewState | Partial<QueryViewState>),
    replace?: boolean,
  ): void {
    registry.update(model.state, (state) =>
      replace
        ? typeof patch === "function"
          ? (patch(state) as QueryViewState)
          : (patch as QueryViewState)
        : patchQueryState(patch)(state),
    );
  }
  return {
    getState: () => registry.get(model.state),
    getInitialState: () => INITIAL_QUERY_STATE,
    setState,
    subscribe: (
      listener: (state: QueryViewState, previous: QueryViewState) => void,
    ) => {
      let previous = registry.get(model.state);
      return registry.subscribe(model.state, (state) => {
        const before = previous;
        previous = state;
        listener(state, before);
      });
    },
  };
}

export function useQueryViewState<T>(
  view: QueryView,
  selector: (state: QueryViewState) => T,
): T {
  const selected = useMemo(
    () => Atom.map(view.model.state, selector),
    [view, selector],
  );
  return useSyncExternalStore(
    (listener) => view.registry.subscribe(selected, listener),
    () => view.registry.get(selected),
    () => view.registry.get(selected),
  );
}
