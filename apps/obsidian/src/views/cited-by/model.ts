// Per-leaf state for one Cited By Sidebar, as atoms in the plugin's view
// registry. The followed note and its Cited By are service atoms
// (`@/services/note-index/atoms`, `@/services/citation-index/atoms`), shared by
// every leaf.
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createContext, useContext } from "react";

import { DEFAULT_CITED_BY_SORT } from "./store";
import type { CitedByPreview, CitedBySortMode, SourceRange } from "./store";

/** The controls the workspace layout carries across a restart. */
export interface CitedByLayout {
  /** The applied filter query; empty while the search field stays closed. */
  readonly search: string;
  readonly searchVisible: boolean;
  /** Whether every excerpt shows its enclosing block instead of its line. */
  readonly moreContext: boolean;
  /** The order the source groups render in. */
  readonly sort: CitedBySortMode;
}

/** What the leaf holds for the followed note only; reset when its key changes. */
export interface CitedByNoteState {
  readonly collapsed: readonly string[];
  /**
   * The manual chevron expansions in force, keyed by `excerptKey`. Held in
   * memory only: they leave with the active Literature Note and never reach
   * the workspace layout.
   */
  readonly expansions: Readonly<Record<string, SourceRange>>;
}

export type CitedByPreviews = Readonly<Record<string, CitedByPreview>>;

export interface CitedByModel {
  readonly layout: Atom.Writable<CitedByLayout>;
  readonly note: Atom.Writable<CitedByNoteState>;
  readonly previews: Atom.Writable<CitedByPreviews>;
}

export const DEFAULT_CITED_BY_LAYOUT: CitedByLayout = {
  search: "",
  searchVisible: false,
  moreContext: false,
  sort: DEFAULT_CITED_BY_SORT,
};

export const EMPTY_CITED_BY_NOTE_STATE: CitedByNoteState = {
  collapsed: [],
  expansions: {},
};

export function makeCitedByModel(
  layout: Partial<CitedByLayout> = {},
): CitedByModel {
  return {
    layout: Atom.make<CitedByLayout>({ ...DEFAULT_CITED_BY_LAYOUT, ...layout }),
    note: Atom.make(EMPTY_CITED_BY_NOTE_STATE),
    previews: Atom.make<CitedByPreviews>({}),
  };
}

/**
 * Holds every atom of `model` in `registry` until the returned release runs.
 * A leaf holds its model from construction to close: Obsidian sets its state
 * before it opens, while no component reads it yet.
 */
export function holdCitedByModel(
  registry: AtomRegistry.AtomRegistry,
  model: CitedByModel,
): () => void {
  const releases = [
    registry.mount(model.layout),
    registry.mount(model.note),
    registry.mount(model.previews),
  ];
  return () => {
    for (const release of releases) release();
  };
}

export const CitedByModelContext = createContext<CitedByModel | null>(null);

export function useCitedByModel(): CitedByModel {
  const model = useContext(CitedByModelContext);
  if (!model) {
    throw new Error("useCitedByModel must be used within CitedByModelContext");
  }
  return model;
}
