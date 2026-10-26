// PROTOTYPE (proto/view-reactivity) — throwaway. The per-leaf view model: atoms
// the ItemView creates, holds, and keeps mounted on the shared registry while
// the leaf lives. The class reaches them for getState/setState, Scope keys,
// header actions and the pane menu; React reads the same atoms.
import { Option, Schema } from "effect";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createContext, useContext } from "react";

export type LabSort = "path" | "count";

const SavedLayout = Schema.Struct({
  search: Schema.optionalKey(Schema.String),
  sort: Schema.optionalKey(Schema.Literals(["path", "count"])),
});

/** What the workspace layout keeps across a restart. */
export interface LabLayout {
  readonly search: string;
  readonly sort: LabSort;
}

const decodeSavedLayout = Schema.decodeUnknownOption(SavedLayout);

export function makeLabViewModel() {
  return {
    /** Saved: getState/setState carry it in the workspace layout. */
    layout: Atom.make({ search: "", sort: "path" } as LabLayout),
    /** In memory for the leaf's life; never saved. */
    collapsed: Atom.make(new Set<string>() as ReadonlySet<string>),
  };
}

export type LabViewModel = ReturnType<typeof makeLabViewModel>;

/** Keep every model atom alive while the leaf lives; returns the release. */
export function holdViewModel(
  registry: AtomRegistry.AtomRegistry,
  model: LabViewModel,
): () => void {
  const atoms: ReadonlyArray<Atom.Atom<unknown>> = Object.values(model);
  const releases = atoms.map((atom) => registry.mount(atom));
  return () => releases.forEach((release) => release());
}

/** The saved layout from a workspace state; a state that fails to decode gives none. */
export function readSavedLayout(state: unknown): Partial<LabLayout> {
  return Option.getOrElse(decodeSavedLayout(state), () => ({}));
}

export const LabViewModelContext = createContext<LabViewModel | null>(null);

export function useLabViewModel(): LabViewModel {
  const model = useContext(LabViewModelContext);
  if (!model) throw new Error("useLabViewModel outside its ItemView");
  return model;
}
