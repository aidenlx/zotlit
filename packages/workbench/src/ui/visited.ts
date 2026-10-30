// A pane or row the reader has opened stays in the page, hidden, after it
// closes, so the editor inside keeps its view instead of rebuilding. One rule
// serves every host — a tab strip, a list of property rows, the web page's own
// panes; only the key, and what tells one key's occupant from another, differ.

import { useCallback, useEffect, useState } from "react";

/** The one memory a host reads: which keys the reader has opened, and as what. */
export interface Retention<K> {
  /**
   * Whether the pane at `key` is the one the reader opened, and so stays
   * mounted. A key whose occupant changed since it was opened is gone.
   */
  isRetained: (key: K) => boolean;
  /** Records that the reader opened the pane at `key`. */
  open: (key: K) => void;
}

/**
 * One retention memory over `occupants`, which names the thing now at each key.
 * A change that moves a thing to another key, or removes it, drops that key's
 * memory, so no pane inherits a stranger's state.
 *
 * `occupants` must be stable for an unchanged list — hold it in a `useMemo` or
 * a module constant — since a new map is read as a new list.
 */
export function useRetention<K>(
  occupants: ReadonlyMap<K, string>,
): Retention<K> {
  const [held, setHeld] = useState<ReadonlyMap<K, string>>(() => new Map());
  useEffect(() => {
    setHeld((current) => {
      const kept = new Map(
        [...current].filter(([key, id]) => occupants.get(key) === id),
      );
      return kept.size === current.size ? current : kept;
    });
  }, [occupants]);
  const isRetained = useCallback(
    (key: K) => occupants.has(key) && held.get(key) === occupants.get(key),
    [held, occupants],
  );
  const open = useCallback(
    (key: K) =>
      setHeld((current) => {
        const id = occupants.get(key);
        if (id === undefined || current.get(key) === id) return current;
        return new Map(current).set(key, id);
      }),
    [occupants],
  );
  return { isRetained, open };
}
