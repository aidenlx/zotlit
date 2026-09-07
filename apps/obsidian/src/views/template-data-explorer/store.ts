// Per-instance store for one Template Data Explorer view: db-readiness, chosen-item identity, and the current Template data root.
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export interface ExplorerState {
  dbReady: boolean;
  data: Record<string, unknown> | null;
  itemLabel: string | null;
  /** Current anchor when the tree is rooted at an annotation instead of the Note Root; null at the Note Root. */
  anchor: { key: string; label: string } | null;
  itemVanished: boolean;
}

export type ExplorerStore = ReturnType<typeof createExplorerStore>;

export function createExplorerStore() {
  return createStore<ExplorerState>()(() => ({
    dbReady: false,
    data: null,
    itemLabel: null,
    anchor: null,
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
