// Per-leaf card, Follow Mode and query atoms, their transitions and UI access.
import { useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
} from "react";
import type { ReactNode } from "react";

import { ViewRegistryProvider } from "@/lib/view-atoms";
import type { ViewRegistryHandle } from "@/lib/view-atoms";
import type { MutationState } from "@/services/annotation-repository/service";
import { IDLE } from "@/services/annotation-repository/write";

import type { CaretPoint } from "./editor-sheet";
import type { AnnotFilter } from "./filter";
import { initialAnnotState, isEditing, filterOf, toggledTags } from "./state";
import type { AnnotState, EditingField, FollowMode } from "./state";
import {
  DEFAULT_FOLLOW_MODE,
  parseAnnotViewState,
  unpinnedMode,
} from "./view-state";
import type { AnnotViewState } from "./view-state";

export interface AnnotViewModel {
  /** The Follow Mode, the mode a pin interrupted, and the pinned Item. */
  readonly state: Atom.Writable<AnnotViewState>;
  readonly cards: Atom.Writable<AnnotState>;
  readonly query: Atom.Writable<string | null>;
}

export function makeAnnotViewModel(
  state: AnnotViewState = parseAnnotViewState(undefined),
): AnnotViewModel {
  const cards = Atom.make({ ...initialAnnotState(), ...state });
  const follow = Atom.writable(
    (get): AnnotViewState => {
      const { followMode, previousMode, pinnedItemKey } = get(cards);
      return { followMode, previousMode, pinnedItemKey };
    },
    (ctx, value: AnnotViewState) =>
      ctx.set(cards, { ...ctx.get(cards), ...value }),
  );
  return { state: follow, cards, query: Atom.make<string | null>(null) };
}

/**
 * Holds every atom of `model` in `registry` until the returned release runs.
 * A leaf holds its model from construction to close: an unmounted writable
 * atom drops its state.
 */
export function holdAnnotViewModel(
  registry: AtomRegistry.AtomRegistry,
  model: AnnotViewModel,
): () => void {
  const release = [
    registry.mount(model.cards),
    registry.mount(model.state),
    registry.mount(model.query),
  ];
  return () => {
    for (const off of release) off();
  };
}

// Transitions: each takes the state it changes and returns the next one, or
// the same state when the gesture changes nothing.

/** Follow a source; a pin it ends forgets its Item. */
export const setFollowMode =
  (mode: Exclude<FollowMode, "pinned">) =>
  (state: AnnotViewState): AnnotViewState =>
    state.followMode === mode
      ? state
      : {
          followMode: mode,
          previousMode: DEFAULT_FOLLOW_MODE,
          pinnedItemKey: null,
        };

/** Pin the Item `itemKey`; Unpin returns to the mode this pin interrupts. */
export const pinItem =
  (itemKey: string) =>
  (state: AnnotViewState): AnnotViewState => ({
    followMode: "pinned",
    previousMode: unpinnedMode(state.followMode),
    pinnedItemKey: itemKey,
  });

/** Pin the Item on screen; with none on screen nothing changes. */
export const pinCurrentItem =
  (pinnable: string | null) =>
  (state: AnnotViewState): AnnotViewState =>
    pinnable === null ? state : pinItem(pinnable)(state);

/** Return to the mode the pin interrupted. */
export const unpin = (state: AnnotViewState): AnnotViewState => ({
  followMode: unpinnedMode(state.previousMode),
  previousMode: DEFAULT_FOLLOW_MODE,
  pinnedItemKey: null,
});

/** Whether two states carry the same saved fields. */
export function sameAnnotViewState(
  a: AnnotViewState,
  b: AnnotViewState,
): boolean {
  return (
    a.followMode === b.followMode &&
    a.previousMode === b.previousMode &&
    a.pinnedItemKey === b.pinnedItemKey
  );
}

/** The Query View's existing layout interface, backed by this leaf's atoms. */
export interface AnnotStore extends Disposable {
  readonly registry: ViewRegistryHandle;
  readonly model: AnnotViewModel;
  hold(): void;
  getState(): AnnotState;
  setState(
    patch: Partial<AnnotState> | ((state: AnnotState) => Partial<AnnotState>),
  ): void;
  subscribe<A>(
    selector: (state: AnnotState) => A,
    listener: (next: A, previous: A) => void,
    options?: { equalityFn?: (a: A, b: A) => boolean },
  ): () => void;
}

export function createAnnotStore(
  registry: ViewRegistryHandle,
  model = makeAnnotViewModel(),
): AnnotStore {
  let release: (() => void) | null = holdAnnotViewModel(registry, model);
  return {
    registry,
    model,
    hold: () => {
      release ??= holdAnnotViewModel(registry, model);
    },
    getState: () => registry.get(model.cards),
    setState: (patch) =>
      registry.update(model.cards, (state) =>
        patchCards(typeof patch === "function" ? patch(state) : patch)(state),
      ),
    subscribe: (selector, listener, options) => {
      let previous = selector(registry.get(model.cards));
      return registry.subscribe(model.cards, (state) => {
        const next = selector(state);
        if ((options?.equalityFn ?? Object.is)(next, previous)) return;
        const last = previous;
        previous = next;
        listener(next, last);
      });
    },
    [Symbol.dispose]: () => {
      release?.();
      release = null;
    },
  };
}

export const patchCards =
  (patch: Partial<AnnotState>) =>
  (state: AnnotState): AnnotState =>
    Object.entries(patch).every(
      ([key, value]) => state[key as keyof AnnotState] === value,
    )
      ? state
      : { ...state, ...patch };

const AnnotModelContext = createContext<AnnotStore | null>(null);

export function AnnotStoreProvider({
  value,
  children,
}: {
  value: AnnotStore;
  children?: ReactNode;
}) {
  return createElement(
    ViewRegistryProvider,
    { registry: value.registry },
    createElement(AnnotModelContext.Provider, { value }, children),
  );
}

function useAnnotStoreApi(): AnnotStore {
  const model = useContext(AnnotModelContext);
  if (!model) throw new Error("Annotation cards need their leaf model");
  return model;
}

export function useAnnotStore<A>(selector: (state: AnnotState) => A): A {
  const { model } = useAnnotStoreApi();
  return useAtomValue(model.cards, selector);
}
/**
 * What the last write left on one Annotation. The stored states are stable
 * objects and {@link IDLE} is a constant, so this selector never builds one —
 * a fresh object would never compare equal to the last snapshot.
 */
export function useMutation(annotationKey: string): MutationState {
  return useAnnotStore((s) => s.mutations.get(annotationKey) ?? IDLE);
}

/**
 * One Annotation field's editor: `open` makes it the editing target, in place
 * of any other, and `close` clears the target while it is still this one, so
 * an editor that unmounts after another opened leaves that one open.
 */
export function useEditingTarget(
  annotationKey: string,
  field: EditingField,
): { open: (caretAt?: CaretPoint) => void; close: () => void } {
  const store = useAnnotStoreApi();
  return {
    open: (caretAt) =>
      store.setState({
        editing: caretAt
          ? { annotationKey, field, caretAt }
          : { annotationKey, field },
      }),
    close: () => {
      if (isEditing(store.getState(), annotationKey, field))
        store.setState({ editing: null });
    },
  };
}

/**
 * Toggle the search row. Closing must also clear the query so a hidden row
 * never keeps filtering the list.
 */
export function useToggleSearchOpen(): () => void {
  const store = useAnnotStoreApi();
  return () => {
    const { searchOpen } = store.getState();
    store.setState(
      searchOpen
        ? { searchOpen: false, filterQuery: "" }
        : { searchOpen: true },
    );
  };
}

/** Collapse a group heading, or expand it again. */
export function useToggleGroupCollapsed(): (groupKey: string) => void {
  const store = useAnnotStoreApi();
  return (groupKey) => {
    const collapsed = new Set(store.getState().collapsedGroups);
    if (!collapsed.delete(groupKey)) collapsed.add(groupKey);
    store.setState({ collapsedGroups: collapsed });
  };
}

export function useSetFilterQuery(): (query: string) => void {
  const store = useAnnotStoreApi();
  return (query) => store.setState({ filterQuery: query });
}

/** Clears filterQuery/selectedColors/selectedTags; leaves searchOpen untouched. */
export function useClearFilters(): () => void {
  const store = useAnnotStoreApi();
  return () =>
    store.setState({ filterQuery: "", selectedColors: [], selectedTags: [] });
}

/**
 * The colour filter after one colour is toggled. Unchanged by the Chooser
 * migration: aidenlx/zotlit#1194 asks for this action to be reused as it
 * stands, so the filter bar names the one colour that moved rather than the
 * store taking a whole selection.
 */
export function useToggleSelectedColor(): (color: string) => void {
  const store = useAnnotStoreApi();
  return (color) => {
    const { selectedColors } = store.getState();
    store.setState({
      selectedColors: selectedColors.includes(color)
        ? selectedColors.filter((c) => c !== color)
        : [...selectedColors, color],
    });
  };
}

/**
 * Takes a whole colour selection, for the Chooser's own action row: clearing
 * names no single colour, so {@link useToggleSelectedColor} has nothing to be
 * handed. Memoised on the store, as {@link useSetSelectedTags} is.
 */
export function useSetSelectedColors(): (colors: string[]) => void {
  const store = useAnnotStoreApi();
  return useCallback(
    (colors) => store.setState({ selectedColors: colors }),
    [store],
  );
}

/** The {@link AnnotFilter} on screen, held while its slices are unchanged. */
export function useAnnotFilter(): AnnotFilter {
  const filterQuery = useAnnotStore((s) => s.filterQuery);
  const selectedColors = useAnnotStore((s) => s.selectedColors);
  const selectedTags = useAnnotStore((s) => s.selectedTags);
  return useMemo(
    () => filterOf({ filterQuery, selectedColors, selectedTags }),
    [filterQuery, selectedColors, selectedTags],
  );
}

/** Memoised on the store, as {@link useSetSelectedTags} is. */
export function useToggleSelectedTag(): (tag: string) => void {
  const store = useAnnotStoreApi();
  return useCallback(
    (tag) =>
      store.setState({
        selectedTags: toggledTags(store.getState().selectedTags, tag),
      }),
    [store],
  );
}

/**
 * Takes a whole tag selection, for a surface that decides the next one itself
 * — the Chooser reports what a tick leaves behind rather than which tag moved.
 *
 * Memoised on the store: the Chooser's row groups are built in a memo over it,
 * and a fresh closure per render would rebuild them on every render of the
 * filter bar.
 */
export function useSetSelectedTags(): (tags: string[]) => void {
  const store = useAnnotStoreApi();
  return useCallback((tags) => store.setState({ selectedTags: tags }), [store]);
}

/** A held read resolves to null when its owner releases it. */
export function observeRead<A, E>(
  registry: ViewRegistryHandle,
  atom: Atom.Atom<import("effect/reactivity/AsyncResult").AsyncResult<A, E>>,
): { promise: Promise<A | null>; [Symbol.dispose](): void } {
  const pending = Promise.withResolvers<A | null>();
  let off = () => {};
  const finish = (result: A | null) => {
    off();
    pending.resolve(result);
  };
  off = registry.subscribe(atom, (result) => {
    if (!result.waiting && result._tag !== "Initial")
      finish(result._tag === "Success" ? result.value : null);
  });
  const result = registry.get(atom);
  if (!result.waiting && result._tag !== "Initial")
    finish(result._tag === "Success" ? result.value : null);
  return { promise: pending.promise, [Symbol.dispose]: () => finish(null) };
}
