import { regex } from "arkregex";
import MiniSearch from "minisearch";

import { parseItemDate, parseItemLanguage } from "@zotlit/db";
import type { IndexedItem, LanguageNameLookup } from "@zotlit/db";
import { Temporal } from "@zotlit/shared/temporal";

import { formatCreator } from "./format-creator";
import { normalize, normalizeWithIndexMap, tokenize } from "./tokenizer";
import type { TokenizerOptions } from "./tokenizer";

/** Structurally compatible with Obsidian's `SearchMatches`. */
export type SearchMatches = [number, number][];

export interface SearchHit<T> {
  item: T;
  score: number;
  matches: SearchMatches;
}

export interface SearchIndex {
  libraryID: number;
  items: readonly IndexedItem[];
  byId: ReadonlyMap<number, IndexedItem>;
  yearById: ReadonlyMap<number, string>;
  citationKeyById: ReadonlyMap<number, string>;
  mini: MiniSearch<IndexedSearchDocument>;
}

export type SearchField =
  | "title"
  | "creators"
  | "publicationTitle"
  | "shortTitle"
  | "court";

export interface ScoringConfig {
  boosts: Record<SearchField, number>;
  /** Recency multiplier `1 + maxBoost * exp(-days / halfLifeDays)`. */
  recencyMaxBoost: number;
  recencyHalfLifeDays: number;
  /** Additive bonus when a query token equals an item's year exactly. */
  exactYearBonus: number;
  /** MiniSearch fuzzy threshold per query term length. */
  fuzzy: (term: string) => number;
  prefix: boolean;
}

export const DEFAULT_SCORING: ScoringConfig = {
  boosts: {
    title: 2.5,
    shortTitle: 2.5,
    creators: 2,
    publicationTitle: 1.5,
    court: 1,
  },
  // Recency boost: items modified in the last few weeks score slightly higher
  // than equally relevant stale ones. Cap ≤1.1× keeps BM25 dominant. The
  // empty-query path uses `dateModified DESC` directly; this only applies to
  // scored queries.
  recencyMaxBoost: 0.1,
  recencyHalfLifeDays: 30,
  exactYearBonus: 0.25,
  fuzzy: (term) => (term.length <= 3 ? 0 : term.length <= 5 ? 0.1 : 0.2),
  prefix: true,
};

export interface SearchIndexOptions {
  tokenizer: TokenizerOptions;
  limit: number;
  scoring?: ScoringConfig;
}

export interface BuildIndexOptions {
  libraryID: number;
  languageLookup?: LanguageNameLookup | null;
}

interface IndexedSearchDocument {
  id: number;
  title: string;
  creators: string;
  publicationTitle: string;
  shortTitle: string;
  court: string;
}

const SEARCH_FIELDS = [
  "title",
  "creators",
  "publicationTitle",
  "shortTitle",
  "court",
] as const satisfies readonly SearchField[];

/** Accumulates a {@link SearchIndex} across batches so a large library can be
 * indexed in chunks with the caller yielding between {@link add} calls. */
export interface SearchIndexBuilder {
  /** Index a batch of items, preserving insertion order in `index.items`. */
  add(items: readonly IndexedItem[]): void;
  build(): SearchIndex;
}

export function createIndexBuilder(
  tokenizerOpts: TokenizerOptions,
  { libraryID, languageLookup = null }: BuildIndexOptions,
): SearchIndexBuilder {
  const mini = new MiniSearch<IndexedSearchDocument>({
    idField: "id",
    fields: [...SEARCH_FIELDS],
    storeFields: [],
    tokenize: (text) => tokenize(text, tokenizerOpts),
    processTerm,
  });
  const items: IndexedItem[] = [];
  const byId = new Map<number, IndexedItem>();
  const yearById = new Map<number, string>();
  const citationKeyById = new Map<number, string>();
  return {
    add(batch) {
      const indexed = batch.map((item) => {
        items.push(item);
        byId.set(item.itemID, item);
        const year = parseItemDate(item.date)?.year?.toString() ?? "";
        yearById.set(item.itemID, year);
        if (item.citationKey) {
          citationKeyById.set(item.itemID, normalize(item.citationKey));
        }
        return toSearchDocument(item, languageLookup);
      });
      mini.addAll(indexed);
    },
    build() {
      return { libraryID, items, byId, yearById, citationKeyById, mini };
    },
  };
}

export function buildIndex(
  items: readonly IndexedItem[],
  tokenizerOpts: TokenizerOptions,
  options: BuildIndexOptions,
): SearchIndex {
  const builder = createIndexBuilder(tokenizerOpts, options);
  builder.add(items);
  return builder.build();
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DOI_RE = regex("\\b10\\.\\d{4,9}/[^\\s\\]\\)]+", "iu");
const ISBN_RE = regex(
  "\\b(?:ISBN[-: ]*)?(?=(?:\\D*\\d){10}(?:(?:\\D*\\d){3})?\\D*\\b)\\d[\\d -]{8,16}[\\dXx]\\b",
  "iu",
);
const BRACKETS_RE = regex("[()\\[\\]{}]", "gu");
const STRIPPED_PUNCT_RE = regex("[,;.]", "gu");
const ET_AL_RE = regex("\\bet\\s+al\\b\\.?|&\\s*\\bal\\b\\.?", "giu");
const AND_RE = regex("\\band\\b", "giu");
const LEADING_AT_RE = regex("^\\s*@", "u");
const WHITESPACE_RE = regex("\\s+", "gu");
const ZOTERO_KEY_RE = regex("^[A-Z0-9]{8}$", "u");
const YEAR_PREFIX_RE = regex("^\\d{1,4}$", "u");

export function cleanQuery(input: string): string {
  if (DOI_RE.test(input) || ISBN_RE.test(input)) return input;

  return input
    .replace(BRACKETS_RE, " ")
    .replace(LEADING_AT_RE, " ")
    .replace(ET_AL_RE, " ")
    .replace(AND_RE, " ")
    .replace(STRIPPED_PUNCT_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

export function searchIndex(
  index: SearchIndex,
  query: string,
  opts: SearchIndexOptions,
): SearchHit<IndexedItem>[] {
  const scoring = opts.scoring ?? DEFAULT_SCORING;
  const cleaned = cleanQuery(query);
  const keyQuery = cleaned.toUpperCase();
  if (ZOTERO_KEY_RE.test(keyQuery)) {
    const item = index.items.find((candidate) => candidate.key === keyQuery);
    return item ? [{ item, score: Infinity, matches: [] }] : [];
  }

  const tokens = queryTokens(cleaned, opts.tokenizer);
  if (tokens.length === 0) return [];

  const candidates = intersectTokenCandidates(index, tokens, scoring);
  if (candidates.size === 0) return [];

  const ctx: SearchContext = {
    nowMs: Temporal.Now.instant().epochMilliseconds,
    scoring,
  };
  const scored = [...candidates.values()]
    .map((candidate) => rankCandidate(candidate, tokens, ctx))
    .sort(compareRankedCandidates)
    .slice(0, opts.limit);

  const termsUnion = new Set<string>();
  for (const { terms } of scored)
    for (const term of terms) termsUnion.add(term);
  const highlightRe = buildHighlightRegex(termsUnion);

  return scored.map(({ item, score }) => ({
    item,
    score,
    matches:
      highlightRe && item.title ? highlightRanges(highlightRe, item.title) : [],
  }));
}

interface SearchContext {
  nowMs: number;
  scoring: ScoringConfig;
}

function recencyMultiplier(item: IndexedItem, ctx: SearchContext): number {
  const daysElapsed = Math.max(
    0,
    (ctx.nowMs - item.dateModified.epochMilliseconds) / MS_PER_DAY,
  );
  return (
    1 +
    ctx.scoring.recencyMaxBoost *
      Math.exp(-daysElapsed / ctx.scoring.recencyHalfLifeDays)
  );
}

interface TokenEvidence {
  miniScore: number;
  terms: Set<string>;
  exactYear: boolean;
}

interface CandidateEvidence {
  item: IndexedItem;
  miniScore: number;
  terms: Set<string>;
  exactYear: boolean;
  citationKey: string | null;
}

type RankedCandidate =
  | {
      tier: 1;
      item: IndexedItem;
      score: number;
      citationKeyLength: number;
      terms: ReadonlySet<string>;
    }
  | {
      tier: 2;
      item: IndexedItem;
      score: number;
      terms: ReadonlySet<string>;
    };

function queryTokens(query: string, opts: TokenizerOptions): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokenize(query, opts)) {
    const normalized = normalize(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function intersectTokenCandidates(
  index: SearchIndex,
  tokens: readonly string[],
  scoring: ScoringConfig,
): Map<number, CandidateEvidence> {
  let candidates: Map<number, CandidateEvidence> | null = null;

  for (const token of tokens) {
    const tokenCandidates = candidatesForToken(index, token, scoring);
    if (tokenCandidates.size === 0) return new Map();

    if (!candidates) {
      candidates = new Map(
        [...tokenCandidates].flatMap(([itemID, evidence]) => {
          const item = index.byId.get(itemID);
          return item
            ? [
                [
                  itemID,
                  {
                    item,
                    miniScore: evidence.miniScore,
                    terms: evidence.terms,
                    exactYear: evidence.exactYear,
                    citationKey: index.citationKeyById.get(itemID) ?? null,
                  },
                ] satisfies [number, CandidateEvidence],
              ]
            : [];
        }),
      );
      continue;
    }

    for (const [itemID, candidate] of candidates) {
      const evidence = tokenCandidates.get(itemID);
      if (!evidence) {
        candidates.delete(itemID);
        continue;
      }
      candidate.miniScore += evidence.miniScore;
      candidate.exactYear ||= evidence.exactYear;
      for (const term of evidence.terms) candidate.terms.add(term);
    }
  }

  return candidates ?? new Map();
}

function candidatesForToken(
  index: SearchIndex,
  token: string,
  scoring: ScoringConfig,
): Map<number, TokenEvidence> {
  const candidates = new Map<number, TokenEvidence>();

  for (const hit of index.mini.search(token, {
    combineWith: "AND",
    prefix: scoring.prefix,
    fuzzy: scoring.fuzzy,
    boost: scoring.boosts,
    tokenize: (text) => [text],
    processTerm: (term) => term,
  })) {
    candidates.set(hit.id as number, {
      miniScore: hit.score,
      terms: new Set(hit.terms),
      exactYear: false,
    });
  }

  const isYearPrefix = YEAR_PREFIX_RE.test(token);
  for (const item of index.items) {
    const citationKey = index.citationKeyById.get(item.itemID);
    const year = index.yearById.get(item.itemID);
    const citationKeyMatch = citationKey?.startsWith(token) ?? false;
    const yearMatch = isYearPrefix && !!year && year.startsWith(token);
    if (!citationKeyMatch && !yearMatch) continue;

    const evidence = candidates.get(item.itemID) ?? {
      miniScore: 0,
      terms: new Set<string>(),
      exactYear: false,
    };
    evidence.exactYear ||= yearMatch && year === token;
    candidates.set(item.itemID, evidence);
  }

  return candidates;
}

function rankCandidate(
  candidate: CandidateEvidence,
  tokens: readonly string[],
  ctx: SearchContext,
): RankedCandidate {
  const { citationKey } = candidate;
  if (citationKey && tokens.every((token) => citationKey.startsWith(token))) {
    return {
      tier: 1,
      item: candidate.item,
      score: Infinity,
      citationKeyLength: citationKey.length,
      terms: candidate.terms,
    };
  }

  return {
    tier: 2,
    item: candidate.item,
    score:
      candidate.miniScore * recencyMultiplier(candidate.item, ctx) +
      (candidate.exactYear ? ctx.scoring.exactYearBonus : 0),
    terms: candidate.terms,
  };
}

function compareRankedCandidates(
  a: RankedCandidate,
  b: RankedCandidate,
): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.tier === 1 && b.tier === 1) {
    return (
      a.citationKeyLength - b.citationKeyLength ||
      compareModifiedDesc(a.item, b.item)
    );
  }
  return b.score - a.score || compareModifiedDesc(a.item, b.item);
}

function compareModifiedDesc(a: IndexedItem, b: IndexedItem): number {
  return b.dateModified.epochMilliseconds - a.dateModified.epochMilliseconds;
}

function toSearchDocument(
  item: IndexedItem,
  languageLookup: LanguageNameLookup | null,
): IndexedSearchDocument {
  const language = parseItemLanguage(item.language, languageLookup);
  return {
    id: item.itemID,
    title: item.title ?? "",
    creators: item.creators
      .map((creator) => formatCreator(creator, language))
      .filter((name) => name.length > 0)
      .join("; "),
    publicationTitle: item.publicationTitle ?? "",
    shortTitle: item.shortTitle ?? "",
    court: item.court ?? "",
  };
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
