// Per-instance state for one Cited By Sidebar.
import type {
  CachedMetadata,
  ListItemCache,
  Pos,
  SectionCache,
} from "obsidian";
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type {
  CitationOccurrence,
  CitedByGroup,
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

/** The logical Markdown structure one citing note's excerpts expand through. */
export interface SourceOutline {
  listItems: readonly ListItemCache[];
  sections: readonly SectionCache[];
}

export type CitedByPreview =
  | { status: "loading"; mtime: number }
  | { status: "unavailable"; mtime: number }
  | {
      status: "ready";
      mtime: number;
      source: string;
      /** Read together with {@link source}, so both describe one revision. */
      outline: SourceOutline;
      contexts: Readonly<Record<string, OccurrenceContext>>;
    };

/** The six Backlinks sort modes, in the pairs the sort menu groups them by. */
export const CITED_BY_SORT_GROUPS = [
  ["alphabetical", "alphabeticalReverse"],
  ["byModifiedTime", "byModifiedTimeReverse"],
  ["byCreatedTime", "byCreatedTimeReverse"],
] as const;

/** The presentation order of the source groups. */
export type CitedBySortMode = (typeof CITED_BY_SORT_GROUPS)[number][number];

export const DEFAULT_CITED_BY_SORT: CitedBySortMode = "alphabetical";

/** Whether one value out of the workspace layout names a sort mode. */
export function isCitedBySortMode(value: unknown): value is CitedBySortMode {
  return CITED_BY_SORT_GROUPS.flat().includes(value as CitedBySortMode);
}

export interface CitedByState {
  indexedKey: string | null;
  activePath: string | null;
  snapshot: CitedBySnapshot;
  /** The applied filter query; empty while the search field stays closed. */
  search: string;
  searchVisible: boolean;
  /** Whether every excerpt shows its enclosing block instead of its line. */
  moreContext: boolean;
  /** The order the source groups render in. */
  sort: CitedBySortMode;
  collapsed: readonly string[];
  sectionCollapsed: boolean;
  previews: Readonly<Record<string, CitedByPreview>>;
  /**
   * The manual chevron expansions in force, keyed by {@link excerptKey}. Held
   * in memory only: they leave with the active Literature Note and never reach
   * the workspace layout.
   */
  expansions: Readonly<Record<string, SourceRange>>;
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
    sort: DEFAULT_CITED_BY_SORT,
    collapsed: [],
    sectionCollapsed: false,
    previews: {},
    expansions: {},
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

/** The vault facts the sort modes read from one citing note. */
export interface SourceFileFacts {
  name: string;
  mtime: number;
  ctime: number;
}

/** Obsidian's own file-name order: case-insensitive and number-aware. */
const nameOrder = new Intl.Collator(undefined, {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});

const SORT_COMPARATORS: Record<
  CitedBySortMode,
  (a: SourceFileFacts, b: SourceFileFacts) => number
> = {
  alphabetical: (a, b) => nameOrder.compare(a.name, b.name),
  alphabeticalReverse: (a, b) => nameOrder.compare(b.name, a.name),
  byModifiedTime: (a, b) => b.mtime - a.mtime,
  byModifiedTimeReverse: (a, b) => a.mtime - b.mtime,
  byCreatedTime: (a, b) => b.ctime - a.ctime,
  byCreatedTimeReverse: (a, b) => a.ctime - b.ctime,
};

/**
 * The source groups in presentation order. The Citation Index emits them in
 * canonical vault path order, and this sort is stable, so that path order
 * breaks every tie. Occurrences inside a group keep their source position.
 *
 * @param facts the vault metadata of one citing note, `null` once its file
 * left the vault: such a group sorts by its own name at time zero.
 */
export function sortCitedByGroups(
  groups: readonly CitedByGroup[],
  mode: CitedBySortMode,
  facts: (path: string) => SourceFileFacts | null,
): readonly CitedByGroup[] {
  const compare = SORT_COMPARATORS[mode];
  return groups
    .map((group) => ({
      group,
      facts: facts(group.path) ?? {
        name: noteName(group.path),
        mtime: 0,
        ctime: 0,
      },
    }))
    .sort((a, b) => compare(a.facts, b.facts))
    .map(({ group }) => group);
}

/** The name one vault path shows, without its Markdown extension. */
export function noteName(path: string): string {
  const slash = path.lastIndexOf("/");
  const filename = path.slice(slash + 1);
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
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
    return {
      // From the start of the item's line, so its marker and indent stay.
      start: lineStartOf(item.position),
      end: listItemEnd(items, index),
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

/** Where one list item ends together with every descendant it owns. */
function listItemEnd(items: readonly ListItemCache[], index: number): number {
  const item = items[index];
  if (!item) return 0;
  const lines = new Set([item.position.start.line]);
  let last = item;
  for (const candidate of items.slice(index + 1)) {
    if (!lines.has(candidate.parent)) break;
    lines.add(candidate.position.start.line);
    last = candidate;
  }
  return last.position.end.offset;
}

/** Where the line that carries one cache entry begins. */
function lineStartOf(position: Pos): number {
  return position.start.offset - position.start.col;
}

export interface ContextParts {
  before: string;
  token: string;
  after: string;
  /** Source text the excerpt leaves out; such an end shows an ellipsis. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

export interface ExcerptOptions {
  /** Show the enclosing block instead of the compact line. */
  moreContext?: boolean;
  /** The manual chevron expansion in force, which only ever widens. */
  expansion?: SourceRange | undefined;
}

/** The source range one excerpt shows under the current mode and expansion. */
export function excerptRange(
  context: ReadyOccurrenceContext,
  options: ExcerptOptions = {},
): SourceRange {
  const mode = options.moreContext ? context.block : context.range;
  const { expansion } = options;
  if (!expansion) return mode;
  return {
    start: Math.min(mode.start, expansion.start),
    end: Math.max(mode.end, expansion.end),
  };
}

/** The excerpt one Citation Context renders, split around its occurrence. */
export function contextParts(
  source: string,
  context: ReadyOccurrenceContext,
  options: ExcerptOptions = {},
): ContextParts {
  const { token } = context;
  const range = excerptRange(context, options);
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

/** The side of an excerpt one chevron reveals more source text on. */
export type ExpandDirection = "before" | "after";

/** The logical Markdown structure of one citing note, as the cache holds it. */
export function sourceOutline(cache: CachedMetadata | null): SourceOutline {
  return { listItems: cache?.listItems ?? [], sections: cache?.sections ?? [] };
}

/**
 * The excerpt range one chevron activation reveals: the adjacent logical
 * Markdown chunk — the list item with its descendants first, then a Markdown
 * section, then the adjacent line. Whitespace-only lines carry no chunk of
 * their own, so one activation crosses them and lands on the next chunk. A
 * range that already reaches its end of the file comes back unchanged.
 */
export function expandExcerptRange(options: {
  source: string;
  outline: SourceOutline;
  range: SourceRange;
  direction: ExpandDirection;
}): SourceRange {
  const { source, outline, range, direction } = options;
  if (direction === "before") {
    let at = range.start;
    while (at > 0) {
      at -= 1;
      const chunkStart = chunkStartAt(source, outline, at);
      if (chunkStart < at) {
        at = chunkStart;
        break;
      }
    }
    return { start: at, end: range.end };
  }
  let at = range.end;
  while (at < source.length) {
    at += 1;
    const chunkEnd = chunkEndAt(source, outline, at);
    if (chunkEnd > at) {
      at = chunkEnd;
      break;
    }
  }
  return { start: range.start, end: at };
}

/** Where the logical chunk that covers one offset begins. */
function chunkStartAt(
  source: string,
  outline: SourceOutline,
  at: number,
): number {
  const item = outline.listItems[coveringIndex(outline.listItems, at)];
  if (item) return lineStartOf(item.position);
  const section = outline.sections[coveringIndex(outline.sections, at)];
  if (section && section.type !== "list") return lineStartOf(section.position);
  return source.lastIndexOf("\n", at - 1) + 1;
}

/** Where the logical chunk that covers one offset ends. */
function chunkEndAt(
  source: string,
  outline: SourceOutline,
  at: number,
): number {
  const index = coveringIndex(outline.listItems, at);
  if (index !== -1) return listItemEnd(outline.listItems, index);
  const section = outline.sections[coveringIndex(outline.sections, at)];
  if (section && section.type !== "list") return section.position.end.offset;
  const lineBreak = source.indexOf("\n", at);
  return lineBreak === -1 ? source.length : lineBreak;
}

/**
 * The innermost cache entry that covers one offset, from the start of its own
 * line so that a list marker and its indent count as part of the item.
 */
function coveringIndex(
  entries: readonly { position: Pos }[],
  at: number,
): number {
  return entries.findLastIndex(
    ({ position }) => lineStartOf(position) <= at && at <= position.end.offset,
  );
}

/** The key one manual excerpt expansion is held under. */
export function excerptKey(
  path: string,
  occurrence: CitationOccurrence,
): string {
  return `${path}\n${occurrenceID(occurrence)}`;
}

/** Whether one expansion key belongs to a given citing note. */
export function excerptKeyIn(key: string, path: string): boolean {
  return key.startsWith(`${path}\n`);
}

export function occurrenceID(options: {
  kind: string;
  raw: string;
  position: { start: { offset: number }; end: { offset: number } };
}): string {
  const { kind, raw, position } = options;
  return `${kind}:${position.start.offset}:${position.end.offset}:${raw}`;
}
