// Per-host Query View state, held in the plugin registry, and its pure transitions.
import { Option, Schema } from "effect";
import type { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

import type { NoticeMessage } from "@/lib/notifier";
import type { ViewRegistryHandle, ViewServices } from "@/lib/view-atoms";

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
  wanted: Atom.make<string | null>(null),
});
export type QueryViewModel = ReturnType<typeof makeQueryViewModel>;

export const holdQueryViewModel = (
  registry: ViewRegistryHandle,
  model: QueryViewModel,
): (() => void) => {
  const releases = [registry.mount(model.state), registry.mount(model.wanted)];
  return () => {
    for (const release of releases) release();
  };
};

const savedQueryView = Schema.Struct({ view: Schema.optional(Schema.String) });
export const readSavedQueryViewName = (state: unknown): string | null =>
  Option.getOrNull(
    Option.flatMap(Schema.decodeUnknownOption(savedQueryView)(state), (saved) =>
      Option.fromNullishOr(saved.view),
    ),
  );

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
    replace?: false,
  ): void;
  function setState(
    state: QueryViewState | ((state: QueryViewState) => QueryViewState),
    replace: true,
  ): void;
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

/** Host-owned controls also read this model outside the Query View root, so the hook uses its registry directly. */
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

/** Runs a table action on the leaf the component draws in; see `QueryView.runTask`. */
export type QueryTaskRunner = (
  task: Effect.Effect<void, unknown, ViewServices>,
  failed?: () => NoticeMessage | undefined,
) => () => void;

const QueryTaskContext = createContext<QueryTaskRunner | null>(null);
export const QueryTaskProvider = QueryTaskContext.Provider;

/** The leaf's task runner, for a part that acts on the vault or the workspace. */
export function useQueryTask(): QueryTaskRunner {
  const run = useContext(QueryTaskContext);
  if (!run)
    throw new Error("useQueryTask must be used within QueryTaskProvider");
  return run;
}
