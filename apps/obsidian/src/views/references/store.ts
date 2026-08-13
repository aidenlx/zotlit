// Per-instance store for one References Sidebar: the reference list and where the engine stands.

import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type {
  Citation,
  DocumentCitationError,
} from "@/services/citation-index/service";
import type { PandocEngineStatus } from "@/services/pandoc/service";

import { buildReferenceEntries } from "./entries";
import type { ReferenceEntry, ReferenceSource } from "./entries";

export type ReferencesListMode =
  | { kind: "minimal" }
  | { kind: "bibliography"; hasEntryMarkers: boolean };

/** Why the current list cannot become a Copied Bibliography. */
export type ReferencesCopyBlock =
  /** No Markdown note is active, so no Document Citation Set answers for one. */
  | "no-note"
  | "no-references"
  /** A render is still running, so the visible entries may be an earlier one. */
  | "pending"
  /** The Pandoc Engine or the selected style cannot format a bibliography. */
  | "unavailable"
  | "failed"
  /** A completed bibliography left at least one Reference Error behind. */
  | "errors";

export type ReferencesCopyState =
  | { kind: "ready" }
  | { kind: "blocked"; reason: ReferencesCopyBlock };

/** Where the current render stands, as copy readiness reads it. */
export type ReferencesFormatting =
  | "pending"
  | "complete"
  | "unavailable"
  | "failed";

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
  /** Whether the visible list can be copied, and why not. */
  copy: ReferencesCopyState;
}

export type ReferencesStore = ReturnType<typeof createReferencesStore>;

export function createReferencesStore() {
  return createStore<ReferencesState>()(() => ({
    entries: [],
    listMode: { kind: "minimal" },
    engine: { kind: "absent" },
    formattingFailed: false,
    dbReady: false,
    copy: { kind: "blocked", reason: "no-note" },
  }));
}

/**
 * Whether the current list is a Copied Bibliography the sidebar can hand over.
 *
 * Only the completed render of the active note qualifies, and only when it
 * covers every citation: retained entries from an earlier generation, a minimal
 * list, and a list still carrying a Reference Error each name their own reason
 * so the disabled action can say what to fix.
 */
export function referencesCopyState({
  hasActiveNote,
  entries,
  formatting,
}: {
  hasActiveNote: boolean;
  entries: readonly ReferenceEntry[];
  formatting: ReferencesFormatting;
}): ReferencesCopyState {
  if (!hasActiveNote) return { kind: "blocked", reason: "no-note" };
  if (entries.length === 0) return { kind: "blocked", reason: "no-references" };
  if (formatting !== "complete") {
    return { kind: "blocked", reason: formatting };
  }
  return entries.every((entry) => entry.kind === "rendered")
    ? { kind: "ready" }
    : { kind: "blocked", reason: "errors" };
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
