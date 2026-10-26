// Per-leaf Follow Mode state for one Annotation View, as an atom in the
// plugin's view registry, and the pure transitions its gestures apply.
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import type { FollowMode } from "./store";
import {
  DEFAULT_FOLLOW_MODE,
  parseAnnotViewState,
  unpinnedMode,
} from "./view-state";
import type { AnnotViewState } from "./view-state";

export interface AnnotViewModel {
  /** The Follow Mode, the mode a pin interrupted, and the pinned Item. */
  readonly state: Atom.Writable<AnnotViewState>;
}

export function makeAnnotViewModel(
  state: AnnotViewState = parseAnnotViewState(undefined),
): AnnotViewModel {
  return { state: Atom.make(state) };
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
  return registry.mount(model.state);
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
