// The `zustand` stand-in the view tests mock the package with. It re-subscribes
// through Preact's own `useSyncExternalStore`, so a component mounted on a
// vanilla store re-renders on every store update the test drives.
import { useSyncExternalStore } from "preact/compat";

export function useStore<T, U>(
  store: {
    subscribe: (listener: () => void) => () => void;
    getState: () => T;
  },
  selector: (state: T) => U,
): U {
  return useSyncExternalStore(store.subscribe, () =>
    selector(store.getState()),
  );
}
