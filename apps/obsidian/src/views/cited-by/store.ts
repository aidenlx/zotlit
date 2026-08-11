// Per-instance state for one Cited By Sidebar.
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { CitedBySnapshot } from "@/services/citation-index/service";

export type OccurrenceContext =
  | { status: "unavailable" }
  | { status: "ready"; before: string; token: string; after: string };

export type CitedByPreview =
  | { status: "loading"; mtime: number }
  | { status: "unavailable"; mtime: number }
  | {
      status: "ready";
      mtime: number;
      source: string;
      contexts: Readonly<Record<string, OccurrenceContext>>;
    };

export interface CitedByState {
  indexedKey: string | null;
  activePath: string | null;
  snapshot: CitedBySnapshot;
  search: string;
  collapsed: readonly string[];
  previews: Readonly<Record<string, CitedByPreview>>;
}

export const EMPTY_CITED_BY_SNAPSHOT: CitedBySnapshot = {
  groups: [],
  coverage: "indexing",
  resolution: "resolving",
};

export type CitedByStore = ReturnType<typeof createCitedByStore>;

export function createCitedByStore() {
  return createStore<CitedByState>()(() => ({
    indexedKey: null,
    activePath: null,
    snapshot: EMPTY_CITED_BY_SNAPSHOT,
    search: "",
    collapsed: [],
    previews: {},
  }));
}

const CitedByStoreContext = createContext<CitedByStore | null>(null);
export const CitedByStoreProvider = CitedByStoreContext.Provider;

export function useCitedByStore<T>(selector: (state: CitedByState) => T): T {
  const store = useContext(CitedByStoreContext);
  if (!store) {
    throw new Error("useCitedByStore must be used within CitedByStoreProvider");
  }
  return useStore(store, selector);
}

export function occurrenceID(options: {
  kind: string;
  raw: string;
  position: { start: { offset: number }; end: { offset: number } };
}): string {
  const { kind, raw, position } = options;
  return `${kind}:${position.start.offset}:${position.end.offset}:${raw}`;
}
