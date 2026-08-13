// Per-instance store for one References Sidebar: the reference list and where the engine stands.

import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type {
  Citation,
  DocumentCitationError,
  ReferenceSource,
} from "@/services/citation-index/service";
import type { PandocEngineStatus } from "@/services/pandoc/service";

import { buildReferenceEntries } from "./entries";
import type { ReferenceEntry } from "./entries";

export type ReferencesListMode =
  | { kind: "minimal" }
  | { kind: "bibliography"; hasEntryMarkers: boolean };

export interface ReferencesState {
  /** Reference list of the active document, in document order. */
  entries: readonly ReferenceEntry[];
  /** Which list owns the marker column. */
  listMode: ReferencesListMode;
  /** Drives the one fallback surface above the list. */
  engine: PandocEngineStatus;
  /** A completed formatting attempt failed while the engine remained available. */
  formattingFailed: boolean;
  /** `false` while the Zotero database cannot be read. */
  dbReady: boolean;
}

export type ReferencesStore = ReturnType<typeof createReferencesStore>;

export function createReferencesStore() {
  return createStore<ReferencesState>()(() => ({
    entries: [],
    listMode: { kind: "minimal" },
    engine: { kind: "absent" },
    formattingFailed: false,
    dbReady: false,
  }));
}

/** The current plain-list state after formatted entries become unusable. */
export function minimalReferencesState(options: {
  citations: readonly Citation[];
  sources: ReadonlyMap<string, ReferenceSource>;
  errors: readonly DocumentCitationError[];
  formattingFailed: boolean;
}): Pick<ReferencesState, "entries" | "listMode" | "formattingFailed"> {
  const { citations, sources, errors, formattingFailed } = options;
  return {
    entries: buildReferenceEntries(citations, sources, { errors }),
    listMode: { kind: "minimal" },
    formattingFailed,
  };
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
