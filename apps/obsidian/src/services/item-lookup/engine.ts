import MiniSearch from "minisearch";
import { type App, type SearchMatches } from "obsidian";

import { type Creator, type Item } from "@zotlit/db";
import { Temporal } from "@zotlit/shared/temporal";

import {
  normalize,
  normalizeWithIndexMap,
  tokenize,
  type ChsSegmenter,
  type TokenizerOptions,
} from "./tokenizer";

export interface SearchHit {
  item: Item;
  score: number;
  matches: SearchMatches;
}

export interface SearchIndex {
  libraryID: number;
  items: readonly Item[];
  byId: ReadonlyMap<number, Item>;
  mini: MiniSearch<IndexedItem>;
}

export interface SearchIndexOptions {
  tokenizer: TokenizerOptions;
  limit: number;
}

interface IndexedItem {
  id: number;
  title: string;
  creators: string;
  date: string;
}

const SEARCH_FIELDS = [
  "title",
  "creators",
  "date",
] as const satisfies readonly (keyof IndexedItem)[];

const SEARCH_BOOST = {
  title: 2.5,
  creators: 2,
  date: 1,
} satisfies Partial<Record<(typeof SEARCH_FIELDS)[number], number>>;

export function buildIndex(
  items: readonly Item[],
  tokenizerOpts: TokenizerOptions,
  libraryID: number,
): SearchIndex {
  const mini = new MiniSearch<IndexedItem>({
    idField: "id",
    fields: [...SEARCH_FIELDS],
    storeFields: [],
    tokenize: (text) => tokenize(text, tokenizerOpts),
    processTerm,
  });
  const byId = new Map<number, Item>();
  const indexed = items.map((item) => {
    byId.set(item.itemID, item);
    return toIndexed(item);
  });
  mini.addAll(indexed);
  return { libraryID, items, byId, mini };
}

// Recency boost: items modified in the last few weeks score slightly higher
// than equally relevant stale ones. Cap ≤1.1× keeps BM25 dominant. The
// empty-query path uses `dateModified DESC` directly; this only applies to
// scored queries.
const RECENCY_MAX_BOOST = 0.1;
const RECENCY_HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function searchIndex(
  index: SearchIndex,
  query: string,
  opts: SearchIndexOptions,
): SearchHit[] {
  const tokens = tokenize(query, opts.tokenizer);
  if (tokens.length === 0) return [];

  const nowMs = Temporal.Now.instant().epochMilliseconds;
  // Two passes: score+sort+slice over the full match set first, then run
  // the expensive `highlightRanges`/`normalizeWithIndexMap` only on the
  // surviving top-N. Broad prefix queries can match thousands of items;
  // without this split, every match pays the title normalize cost.
  const scored = index.mini
    .search(tokens.join(" "), {
      combineWith: "AND",
      prefix: true,
      fuzzy: (term) => (term.length <= 3 ? 0 : term.length <= 5 ? 0.1 : 0.2),
      boost: SEARCH_BOOST,
      tokenize: (text) => text.split(" ").filter((part) => part.length > 0),
      processTerm: normalize,
    })
    .flatMap((hit) => {
      const item = index.byId.get(hit.id);
      if (!item) return [];
      return [{ hit, item, score: hit.score * recencyMultiplier(item, nowMs) }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit);

  const termsUnion = new Set<string>();
  for (const { hit } of scored)
    for (const term of hit.terms) termsUnion.add(term);
  const highlightRe = buildHighlightRegex(termsUnion);

  return scored.map(({ item, score }) => ({
    item,
    score,
    matches: highlightRe ? highlightRanges(highlightRe, item.title ?? "") : [],
  }));
}

function recencyMultiplier(item: Item, nowMs: number): number {
  const daysElapsed = Math.max(
    0,
    (nowMs - item.dateModified.epochMilliseconds) / MS_PER_DAY,
  );
  return (
    1 + RECENCY_MAX_BOOST * Math.exp(-daysElapsed / RECENCY_HALF_LIFE_DAYS)
  );
}

export function getChsSegmenter(
  app: App | null | undefined,
): ChsSegmenter | null {
  const plugin = app?.plugins?.plugins?.["cm-chs-patch"];
  if (!plugin || typeof plugin !== "object") return null;

  const cut = (plugin as { cut?: unknown }).cut;
  return typeof cut === "function" ? (plugin as ChsSegmenter) : null;
}

function toIndexed(item: Item): IndexedItem {
  return {
    id: item.itemID,
    title: item.title ?? "",
    creators: creatorsToSearchText(item.creators),
    date: item.date ?? "",
  };
}

function creatorsToSearchText(creators: readonly Creator[]): string {
  return creators
    .map((creator) =>
      [creator.lastName, creator.firstName].filter(Boolean).join(" "),
    )
    .filter((name) => name.length > 0)
    .join("; ");
}

function processTerm(term: string): string | null {
  const normalized = normalize(term);
  return normalized.length > 0 ? normalized : null;
}

// `hit.terms` is the indexed terms that actually matched (after prefix
// and fuzzy expansion). `hit.queryTerms` is the raw user input, which for
// a fuzzy hit like `utilz` → `util` never appears in the title and would
// render no highlight.
function buildHighlightRegex(terms: ReadonlySet<string>): RegExp | null {
  if (terms.size === 0) return null;
  const escaped = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((v) => RegExp.escape(v));
  return new RegExp(`\\b(${escaped.join("|")})`, "giu");
}

function highlightRanges(re: RegExp, title: string): SearchMatches {
  if (!title) return [];

  // Match in normalized space so terms align with diacritic-folded titles
  // (`util` ↔ `útil`); map offsets back so renderMatches lights up the
  // original glyphs.
  const { normalized, indexMap } = normalizeWithIndexMap(title);

  const ranges: SearchMatches = [];
  for (const match of normalized.matchAll(re)) {
    ranges.push([
      indexMap[match.index]!,
      indexMap[match.index + match[0].length]!,
    ]);
  }
  return ranges;
}
