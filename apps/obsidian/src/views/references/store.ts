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
  | {
      kind: "bibliography";
      hasEntryMarkers: boolean;
      /**
       * Whether the document's citations show Entry Serials, which puts the
       * same digits in this list's gutter. An entry's own Entry Marker keeps
       * the gutter where the style writes one.
       */
      entrySerials: boolean;
    };

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

/** Which note and render generation one Copied Bibliography answers for. */
export interface ReferencesCopyTarget {
  /** Path of the Markdown note whose Document Citation Set the entries cover. */
  path: string;
  /** The completed render generation the entries came from. */
  generation: number;
}

export type ReferencesCopyState =
  /** `target` travels with the click, so a copy taken later can be refused. */
  | { kind: "ready"; target: ReferencesCopyTarget }
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
  path,
  generation,
  entries,
  formatting,
}: {
  /** The Markdown note the entries answer for, or `null` when none does. */
  path: string | null;
  /** The render generation the entries were built for. */
  generation: number;
  entries: readonly ReferenceEntry[];
  formatting: ReferencesFormatting;
}): ReferencesCopyState {
  if (path === null) return { kind: "blocked", reason: "no-note" };
  if (entries.length === 0) return { kind: "blocked", reason: "no-references" };
  if (formatting !== "complete") {
    return { kind: "blocked", reason: formatting };
  }
  return entries.every((entry) => entry.kind === "rendered")
    ? { kind: "ready", target: { path, generation } }
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
