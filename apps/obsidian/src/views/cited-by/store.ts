// Per-instance state for one Cited By Sidebar.
import type { CachedMetadata, Pos } from "obsidian";
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
  /** The compact Citation Context: every source line the occurrence spans. */
  range: SourceRange;
  /**
   * The Citation Context the Show more context mode shows: the enclosing
   * logical block, or {@link range} where the metadata cache resolves none.
   */
  block: SourceRange;
  /** The occurrence itself, always inside both ranges. */
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
  /** Whether every excerpt shows its enclosing block instead of its line. */
  moreContext: boolean;
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
    moreContext: false,
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

/** The Citation Context of one occurrence: its own lines and its block. */
export function citationContext(
  source: string,
  occurrence: CitationOccurrence | null,
  cache: CachedMetadata | null,
): OccurrenceContext {
  if (!occurrence) return { status: "unavailable" };
  const { start, end } = occurrence.position;
  const lineStart = source.lastIndexOf("\n", Math.max(0, start.offset - 1)) + 1;
  const nextBreak = source.indexOf("\n", end.offset);
  const token = { start: start.offset, end: end.offset };
  const range = {
    start: lineStart,
    end: nextBreak === -1 ? source.length : nextBreak,
  };
  return {
    status: "ready",
    range,
    block: enclosingBlock(cache, token) ?? range,
    token,
  };
}

/**
 * The logical block one occurrence sits in, read from the metadata cache: the
 * list item it belongs to together with that item's descendants, otherwise the
 * section entry that encloses it. A heading section spans its own line only,
 * so a heading never widens the excerpt.
 */
function enclosingBlock(
  cache: CachedMetadata | null,
  token: SourceRange,
): SourceRange | null {
  const items = cache?.listItems ?? [];
  const index = items.findIndex(({ position }) => encloses(position, token));
  const item = items[index];
  if (item) {
    const lines = new Set([item.position.start.line]);
    let last = item;
    for (const candidate of items.slice(index + 1)) {
      if (!lines.has(candidate.parent)) break;
      lines.add(candidate.position.start.line);
      last = candidate;
    }
    return {
      // From the start of the item's line, so its marker and indent stay.
      start: item.position.start.offset - item.position.start.col,
      end: last.position.end.offset,
    };
  }
  const section = cache?.sections?.find(
    ({ position, type }) => type !== "list" && encloses(position, token),
  );
  if (!section) return null;
  return {
    start: section.position.start.offset,
    end: section.position.end.offset,
  };
}

function encloses(position: Pos, token: SourceRange): boolean {
  return (
    position.start.offset <= token.start && token.end <= position.end.offset
  );
}

export interface ContextParts {
  before: string;
  token: string;
  after: string;
  /** Source text the excerpt leaves out; such an end shows an ellipsis. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * The excerpt one Citation Context renders, split around its occurrence.
 *
 * @param moreContext show the enclosing block instead of the compact line.
 */
export function contextParts(
  source: string,
  context: ReadyOccurrenceContext,
  moreContext = false,
): ContextParts {
  const { token } = context;
  const range = moreContext ? context.block : context.range;
  return {
    before: source.slice(range.start, token.start),
    token: source.slice(token.start, token.end),
    after: source.slice(token.end, range.end),
    clippedStart: hasText(source, 0, range.start),
    clippedEnd: hasText(source, range.end, source.length),
  };
}

const WHITESPACE = /\s/u;

/** Whether anything other than whitespace sits between two offsets. */
function hasText(source: string, from: number, to: number): boolean {
  for (let at = from; at < to; at += 1) {
    if (!WHITESPACE.test(source.charAt(at))) return true;
  }
  return false;
}

export function occurrenceID(options: {
  kind: string;
  raw: string;
  position: { start: { offset: number }; end: { offset: number } };
}): string {
  const { kind, raw, position } = options;
  return `${kind}:${position.start.offset}:${position.end.offset}:${raw}`;
}
