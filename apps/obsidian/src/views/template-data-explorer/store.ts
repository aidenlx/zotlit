// Per-instance store for one Template Data Explorer view: db-readiness, chosen-item identity, and the built display-tree nodes.
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { DisplayNode } from "./display-tree";

export interface ExplorerState {
  dbReady: boolean;
  itemLabel: string | null;
  /** Built display-tree nodes for the current context; null before the first build or when no item. */
  nodes: readonly DisplayNode[] | null;
  /** Current anchor when the tree is rooted at an annotation instead of the Note Root; null at the Note Root. */
  anchor: { key: string; label: string } | null;
  /** Current filter query; empty string means no filter active. */
  filterQuery: string;
  /** Keys of nodes whose label/value directly matched the filter; null when filter is inactive. */
  matchedKeys: ReadonlySet<string> | null;
  itemVanished: boolean;
}

export type ExplorerStore = ReturnType<typeof createExplorerStore>;

export function createExplorerStore() {
  return createStore<ExplorerState>()(() => ({
    dbReady: false,
    itemLabel: null,
    nodes: null,
    anchor: null,
    filterQuery: "",
    matchedKeys: null,
    itemVanished: false,
  }));
}

const ExplorerStoreContext = createContext<ExplorerStore | null>(null);
export const ExplorerStoreProvider = ExplorerStoreContext.Provider;

function useExplorerStoreApi(): ExplorerStore {
  const store = useContext(ExplorerStoreContext);
  if (!store) {
    throw new Error(
      "useExplorerStore must be used within ExplorerStoreProvider",
    );
  }
  return store;
}

export function useExplorerStore<T>(selector: (s: ExplorerState) => T): T {
  return useStore(useExplorerStoreApi(), selector);
}
