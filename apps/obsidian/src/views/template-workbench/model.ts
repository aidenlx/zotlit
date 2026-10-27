// Per-leaf Workbench atoms, with the external-store interface the shared UI reads.
import { Option, Schema } from "effect";
import * as Atom from "effect/reactivity/Atom";

import type { WorkbenchStore, WorkbenchViewState } from "@zotlit/workbench/ui";

import type { ViewRegistryHandle } from "@/lib/view-atoms";

export const patchWorkbench =
  (patch: Partial<WorkbenchViewState>) =>
  (state: WorkbenchViewState): WorkbenchViewState =>
    Object.entries(patch).every(
      ([key, value]) => state[key as keyof WorkbenchViewState] === value,
    )
      ? state
      : { ...state, ...patch };

export function makeWorkbenchModel() {
  const state = Atom.make<WorkbenchViewState>({
    presentation: {
      restoreVersion: 0,
      restoring: false,
      selection: null,
      selected: null,
      reveal: null,
      fieldFocus: null,
      scroll: {},
    },
    tab: "note",
    item: null,
    root: "note",
    advanced: false,
    customization: "idle",
  });
  const documentRevision = Atom.make(0);
  const partialProfile = Atom.make<string | null>(null);
  return { state, documentRevision, partialProfile };
}
export type WorkbenchModel = ReturnType<typeof makeWorkbenchModel>;

export function holdWorkbenchModel(
  registry: ViewRegistryHandle,
  model: WorkbenchModel,
) {
  const releases = [
    registry.mount(model.state),
    registry.mount(model.documentRevision),
    registry.mount(model.partialProfile),
  ];
  return () => {
    for (const release of releases.reverse()) release();
  };
}

/** The package keeps its interface; all state lives in this leaf's registry. */
export function workbenchStore(
  registry: ViewRegistryHandle,
  model: WorkbenchModel,
): WorkbenchStore {
  const update = (patch: Partial<WorkbenchViewState>) =>
    registry.update(model.state, patchWorkbench(patch));
  const actions = {
    setTab: (tab: WorkbenchViewState["tab"]) => update({ tab }),
    setItem: (item: WorkbenchViewState["item"]) => update({ item }),
    setRoot: (root: WorkbenchViewState["root"]) => update({ root }),
    setAdvanced: (advanced: boolean) => update({ advanced }),
  };
  const state = Atom.map(model.state, (state) => ({ ...state, ...actions }));
  const initial = { ...registry.get(model.state), ...actions };
  return {
    getState: () => registry.get(state),
    getInitialState: () => initial,
    setState: (patch) => {
      const current = registry.get(state);
      update(typeof patch === "function" ? patch(current) : patch);
    },
    subscribe: (listener) => {
      let previous = registry.get(state);
      return registry.subscribe(state, (next) => {
        const before = previous;
        previous = next;
        listener(next, before);
      });
    },
  };
}

const record = Schema.Record(Schema.String, Schema.Unknown);
export function readWorkbenchRecord(
  input: unknown,
): Record<string, unknown> | null {
  return Option.getOrNull(Schema.decodeUnknownOption(record)(input));
}
export const readWorkbenchString = (input: unknown) =>
  Option.getOrNull(Schema.decodeUnknownOption(Schema.String)(input));
export const readWorkbenchBoolean = (input: unknown) =>
  Option.getOrNull(Schema.decodeUnknownOption(Schema.Boolean)(input));
export const readWorkbenchNumber = (input: unknown) =>
  Option.getOrNull(Schema.decodeUnknownOption(Schema.Finite)(input));
