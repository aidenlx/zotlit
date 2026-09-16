// Preact's `useSyncExternalStore`, in the shape React's shim publishes.
//
// Base UI reaches for `use-sync-external-store` so it can run on React 17.
// That package is CommonJS only, so its `require("react")` resolves under the
// `require` condition: through the Preact alias to `preact/compat`'s CommonJS
// build, and from there to `preact/dist/preact.js` — while every module Vite
// resolves as ESM reaches `preact/dist/preact.mjs`. Two Preact cores end up in
// one bundle, each with its own `options` object, so the hooks the CommonJS
// copy installs never see a current component and the first hook call throws
// `Cannot read properties of undefined (reading '__H')`. The Annotation View
// renders nothing at all.
//
// Aliasing both shim entry points here gives the whole tree one Preact. The
// alias belongs in `vite.config.ts` and `vitest.config.ts` alike: this is the
// shipped bundle's problem first, and the test runner's only incidentally.
//
// @see https://github.com/aidenlx/zotlit/issues/1146
import { useCallback, useRef, useSyncExternalStore } from "preact/compat";

export { useSyncExternalStore };

/** One remembered snapshot and what the selector answered for it. */
interface Selection<Snapshot, Value> {
  snapshot: Snapshot;
  value: Value;
}

/**
 * Reads a store through a selector, holding the previous answer while the
 * snapshot is unchanged or the selections compare equal, so a selector that
 * builds a fresh object each call does not re-render on every store event.
 *
 * The five positional parameters are React's own shim signature, which the
 * callers in `node_modules` already compiled against; an options object here
 * would not be the function they call.
 */
// oxlint-disable-next-line max-params -- the shim's published call shape
export function useSyncExternalStoreWithSelector<Snapshot, Value>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  _getServerSnapshot: undefined | (() => Snapshot),
  selector: (snapshot: Snapshot) => Value,
  isEqual?: (a: Value, b: Value) => boolean,
): Value {
  const held = useRef<Selection<Snapshot, Value> | null>(null);
  const select = useCallback(() => {
    const snapshot = getSnapshot();
    const previous = held.current;
    if (previous && Object.is(previous.snapshot, snapshot)) {
      return previous.value;
    }
    const value = selector(snapshot);
    if (previous && isEqual?.(previous.value, value)) {
      held.current = { snapshot, value: previous.value };
      return previous.value;
    }
    held.current = { snapshot, value };
    return value;
  }, [getSnapshot, selector, isEqual]);
  return useSyncExternalStore(subscribe, select);
}
