// A store for plain code that draws synchronously: one writable atom in its
// own atom registry. The registry tells its subscribers in the call that
// changed the state, so a surface draws inside that update.
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { scheduleBrowserTask } from "@/lib/browser-scheduler";

/** The one way plain code reads, changes and watches one state record. */
export interface AtomStore<S extends object> {
  /** The state as it stands now. */
  getState(): S;
  /**
   * Merges a patch, or what `patch` answers for the held state, into a new
   * state, and tells the subscribers before it returns.
   */
  setState(patch: Partial<S> | ((state: S) => Partial<S>)): void;
  /**
   * Calls `listener` with the selection and the one before it each time
   * `selector` answers a value `equalityFn` holds different, in the update
   * that changed it. Listeners run in the order they subscribed.
   *
   * @param options.equalityFn what counts as no change; `Object.is` by default.
   * @param options.fireImmediately whether `listener` also runs at once, with
   *   the current selection as both values.
   * @returns what stops the listening.
   */
  subscribe<T>(
    selector: (state: S) => T,
    listener: (selection: T, previous: T) => void,
    options?: {
      readonly equalityFn?: (a: T, b: T) => boolean;
      readonly fireImmediately?: boolean;
    },
  ): () => void;
}

/**
 * A store over `initial`. The registry holds no work and no timer, so the
 * store needs no disposal and goes with its owner; a write that settles after
 * the owner closed still lands.
 */
export function makeAtomStore<S extends object>(initial: S): AtomStore<S> {
  const registry = AtomRegistry.make({ scheduleTask: scheduleBrowserTask });
  // Kept alive: the state stands while nothing subscribes to it.
  const state = Atom.keepAlive(Atom.make<S>(initial));
  return {
    getState: () => registry.get(state),
    setState: (patch) =>
      registry.update(state, (held) => ({
        ...held,
        ...(typeof patch === "function" ? patch(held) : patch),
      })),
    subscribe: (
      selector,
      listener,
      { equalityFn = Object.is, fireImmediately = false } = {},
    ) => {
      let previous = selector(registry.get(state));
      if (fireImmediately) listener(previous, previous);
      return registry.subscribe(state, (held) => {
        const next = selector(held);
        if (equalityFn(previous, next)) return;
        const before = previous;
        previous = next;
        listener(next, before);
      });
    },
  };
}
