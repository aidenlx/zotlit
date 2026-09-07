// Pure, immutable transitions over the Template Data Explorer's root-scoped navigation state (anchor, filter, expansion).

export interface TreeState {
  readonly anchorKey: string | null;
  readonly filterQuery: string;
  readonly expanded: ReadonlySet<string>;
  /** Stash of the note-root `expanded` set while anchored; restored when returning to the note root. */
  readonly noteRootExpanded: ReadonlySet<string> | null;
  /** Stash of `expanded` from before the filter was typed; restored on clear. */
  readonly preFilterExpanded: ReadonlySet<string> | null;
  /** Transient collapse set for filter mode; keys here render collapsed even though they matched. */
  readonly filterCollapsed: ReadonlySet<string>;
}

export function initialTreeState(anchorKey: string | null = null): TreeState {
  return {
    anchorKey,
    filterQuery: "",
    expanded: new Set(),
    noteRootExpanded: null,
    preFilterExpanded: null,
    filterCollapsed: new Set(),
  };
}

export function toggleNode(state: TreeState, key: string): TreeState {
  if (state.filterQuery) {
    return { ...state, filterCollapsed: toggleSet(state.filterCollapsed, key) };
  }
  return { ...state, expanded: toggleSet(state.expanded, key) };
}

export function setFilter(state: TreeState, query: string): TreeState {
  const wasFiltering = state.filterQuery !== "";
  const isFiltering = query !== "";

  let expanded = state.expanded;
  let preFilterExpanded = state.preFilterExpanded;
  if (!wasFiltering && isFiltering) {
    preFilterExpanded = new Set(state.expanded);
  } else if (wasFiltering && !isFiltering) {
    expanded = preFilterExpanded ?? new Set();
    preFilterExpanded = null;
  }

  return {
    ...state,
    filterQuery: query,
    expanded,
    preFilterExpanded,
    filterCollapsed: new Set(),
  };
}

export function setAnchor(state: TreeState, key: string | null): TreeState {
  const unfiltered: TreeState = {
    ...state,
    filterQuery: "",
    filterCollapsed: new Set(),
    preFilterExpanded: null,
  };

  if (unfiltered.anchorKey === null && key !== null) {
    return {
      ...unfiltered,
      anchorKey: key,
      noteRootExpanded: unfiltered.expanded,
      expanded: new Set(),
    };
  }

  if (key === null) {
    return {
      ...unfiltered,
      anchorKey: null,
      expanded: unfiltered.noteRootExpanded ?? new Set(),
      noteRootExpanded: null,
    };
  }

  return { ...unfiltered, anchorKey: key, expanded: new Set() };
}

function toggleSet(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
