// Per-leaf state for one Cited By Sidebar, as atoms in the plugin's view
// registry, and the pure transitions its controls apply. The followed note,
// its Cited By and the previews are shared view atoms (`./atoms`,
// `@/services/note-index/atoms`, `@/services/citation-index/atoms`).
import { Option, Schema } from "effect";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createContext, useContext } from "react";

import type {
  CitationOccurrence,
  CitedByGroup,
} from "@/services/citation-index/service";

import {
  CITED_BY_SORT_GROUPS,
  DEFAULT_CITED_BY_SORT,
  excerptKey,
  excerptKeyIn,
  excerptRange,
  expandExcerptRange,
  occurrenceID,
  previewContexts,
} from "./store";
import type {
  CitedBySortMode,
  ExpandDirection,
  ReadyPreview,
  SourceRange,
} from "./store";

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

export interface CitedByModel {
  readonly layout: Atom.Writable<CitedByLayout>;
  readonly note: Atom.Writable<CitedByNoteState>;
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
  const releases = [registry.mount(model.layout), registry.mount(model.note)];
  return () => {
    for (const release of releases) release();
  };
}

/** Each saved control, decoded on its own: one bad field leaves the others. */
const SAVED_LAYOUT = {
  search: Schema.String,
  searchVisible: Schema.Boolean,
  moreContext: Schema.Boolean,
  sort: Schema.Literals(CITED_BY_SORT_GROUPS.flat()),
} satisfies { [K in keyof CitedByLayout]: Schema.Codec<CitedByLayout[K]> };

/** The controls a workspace layout holds; anything else in `state` stays out. */
export function readSavedLayout(state: unknown): Partial<CitedByLayout> {
  if (!state || typeof state !== "object") return {};
  const saved = state as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(SAVED_LAYOUT).flatMap(([key, schema]) =>
      Option.match(
        Schema.decodeUnknownOption(schema as Schema.Codec<unknown>)(saved[key]),
        { onNone: () => [], onSome: (value) => [[key, value]] },
      ),
    ),
  );
}

// Transitions: each takes the state it changes and returns the next one.

/** Show or hide the search field; hiding also drops the applied query. */
export const toggleSearch = (layout: CitedByLayout): CitedByLayout =>
  layout.searchVisible
    ? { ...layout, searchVisible: false, search: "" }
    : { ...layout, searchVisible: true };

export const toggleGroup =
  (path: string) =>
  (note: CitedByNoteState): CitedByNoteState => ({
    ...note,
    collapsed: note.collapsed.includes(path)
      ? note.collapsed.filter((item) => item !== path)
      : [...note.collapsed, path],
  });

export const collapseAll =
  (paths: readonly string[]) =>
  (note: CitedByNoteState): CitedByNoteState => ({
    ...note,
    collapsed: [...new Set([...note.collapsed, ...paths])],
  });

/** Expand `paths`, or every group without them. */
export const expandAll =
  (paths?: readonly string[]) =>
  (note: CitedByNoteState): CitedByNoteState => ({
    ...note,
    collapsed: paths
      ? note.collapsed.filter((path) => !paths.includes(path))
      : [],
  });

/** Reveal the logical chunk next to one excerpt on one of its sides. */
export const expandExcerpt =
  (options: {
    readonly preview: ReadyPreview;
    readonly moreContext: boolean;
    readonly group: CitedByGroup;
    readonly occurrence: CitationOccurrence;
    readonly direction: ExpandDirection;
  }) =>
  (note: CitedByNoteState): CitedByNoteState => {
    const { preview, moreContext, group, occurrence, direction } = options;
    const context = previewContexts(preview, [occurrence])[
      occurrenceID(occurrence)
    ];
    if (context?.status !== "ready") return note;
    const key = excerptKey(group.path, occurrence);
    const range = expandExcerptRange({
      source: preview.source,
      outline: preview.outline,
      range: excerptRange(context, {
        moreContext,
        expansion: note.expansions[key],
      }),
      direction,
    });
    return { ...note, expansions: { ...note.expansions, [key]: range } };
  };

/**
 * Drop the expansions of notes that changed: each holds offsets into a
 * source that is gone, so their excerpts start from their mode range again.
 */
export const dropExpansions =
  (paths: readonly string[]) =>
  (note: CitedByNoteState): CitedByNoteState => {
    const kept = Object.entries(note.expansions).filter(
      ([key]) => !paths.some((path) => excerptKeyIn(key, path)),
    );
    return kept.length === Object.keys(note.expansions).length
      ? note
      : { ...note, expansions: Object.fromEntries(kept) };
  };

export const CitedByModelContext = createContext<CitedByModel | null>(null);

export function useCitedByModel(): CitedByModel {
  const model = useContext(CitedByModelContext);
  if (!model) {
    throw new Error("useCitedByModel must be used within CitedByModelContext");
  }
  return model;
}
