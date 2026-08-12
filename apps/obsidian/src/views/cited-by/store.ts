// Per-instance state for one Cited By Sidebar.
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type {
  CitationOccurrence,
  CitedBySnapshot,
} from "@/services/citation-index/service";

/** A half-open `[start, end)` offset range into a citing note's source. */
export interface SourceRange {
  start: number;
  end: number;
}

export interface ReadyOccurrenceContext {
  status: "ready";
  /** The Citation Context: the source range shown around the occurrence. */
  range: SourceRange;
  /** The occurrence itself, always inside {@link range}. */
  token: SourceRange;
}

export type OccurrenceContext =
  | { status: "unavailable" }
  | ReadyOccurrenceContext;

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
  /** The applied filter query; empty while the search field stays closed. */
  search: string;
  searchVisible: boolean;
  collapsed: readonly string[];
  sectionCollapsed: boolean;
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
    searchVisible: false,
    collapsed: [],
    sectionCollapsed: false,
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

/** The Citation Context of one occurrence: every source line it spans. */
export function citationContext(
  source: string,
  occurrence: CitationOccurrence | null,
): OccurrenceContext {
  if (!occurrence) return { status: "unavailable" };
  const { start, end } = occurrence.position;
  const lineStart = source.lastIndexOf("\n", Math.max(0, start.offset - 1)) + 1;
  const nextBreak = source.indexOf("\n", end.offset);
  return {
    status: "ready",
    range: {
      start: lineStart,
      end: nextBreak === -1 ? source.length : nextBreak,
    },
    token: { start: start.offset, end: end.offset },
  };
}

/** The excerpt one Citation Context renders, split around its occurrence. */
export function contextParts(
  source: string,
  context: ReadyOccurrenceContext,
): { before: string; token: string; after: string } {
  const { range, token } = context;
  return {
    before: source.slice(range.start, token.start),
    token: source.slice(token.start, token.end),
    after: source.slice(token.end, range.end),
  };
}

export function occurrenceID(options: {
  kind: string;
  raw: string;
  position: { start: { offset: number }; end: { offset: number } };
}): string {
  const { kind, raw, position } = options;
  return `${kind}:${position.start.offset}:${position.end.offset}:${raw}`;
}
