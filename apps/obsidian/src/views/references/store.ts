// Per-instance store for one References Sidebar: the reference list and where the engine stands.

import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { PandocEngineStatus } from "@/services/pandoc/service";

import type { ReferenceEntry } from "./entries";

export interface ReferencesState {
  /** Reference list of the active document, in document order. */
  entries: readonly ReferenceEntry[];
  /** Drives the one fallback surface above the list. */
  engine: PandocEngineStatus;
  /** `false` while the Zotero database cannot be read. */
  dbReady: boolean;
}

export type ReferencesStore = ReturnType<typeof createReferencesStore>;

export function createReferencesStore() {
  return createStore<ReferencesState>()(() => ({
    entries: [],
    engine: { kind: "absent" },
    dbReady: false,
  }));
}

const ReferencesStoreContext = createContext<ReferencesStore | null>(null);
export const ReferencesStoreProvider = ReferencesStoreContext.Provider;

export function useReferencesStore<T>(selector: (s: ReferencesState) => T): T {
  const store = useContext(ReferencesStoreContext);
  if (!store) {
    throw new Error(
      "useReferencesStore must be used within ReferencesStoreProvider",
    );
  }
  return useStore(store, selector);
}
