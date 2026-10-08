import { regex } from "arkregex";
import { Effect, Stream } from "effect";
import MiniSearch from "minisearch";
import type { SearchResult } from "minisearch";

import { parseItemDate, parseItemLanguage } from "@zotlit/db";
import type { IndexedItem, LanguageNameLookup } from "@zotlit/db";

import { formatCreator } from "./format-creator";
import { Segmenter } from "./segmenter";
import { normalize, normalizeWithIndexMap } from "./tokenizer";

/** Structurally compatible with Obsidian's `SearchMatches`. */
export type SearchMatches = [number, number][];

/**
 * One ranked Item of a search, lean enough to cross a worker boundary: the
 * caller hydrates it by {@link ItemHit.indexedKey}.
 */
export interface ItemHit {
  itemID: number;
  indexedKey: string;
  libraryID: number;
  /** Highlight ranges in the original offsets of the Item's title. */
  matches: SearchMatches;
}

export interface EngineIndexOptions {
  /**
   * Local `libraryID`s of every Library the index covers, in canonical order.
   * Their positions become the Library tie-breaker; a `libraryID` absent from
   * this list sorts after every listed one.
   */
  libraries: readonly number[];
  languageLookup?: LanguageNameLookup | null;
}

/** The fields an Item is indexed under; each query term may match any of them. */
export type SearchField =
  | "title"
  | "shortTitle"
  | "creators"
  | "publicationTitle"
  | "court"
  | "citationKey"
  | "key"
  | "year";

const SEARCH_FIELDS = [
  "title",
  "shortTitle",
  "creators",
  "publicationTitle",
  "court",
  "citationKey",
  "key",
  "year",
] as const satisfies readonly SearchField[];

const BOOSTS: Record<SearchField, number> = {
  title: 2.5,
  shortTitle: 2.5,
  creators: 2,
  citationKey: 2,
  publicationTitle: 1.5,
  court: 1,
  key: 1,
  year: 1,
};

/** Terms of three characters or fewer match exactly or by prefix only. */
function fuzziness(term: string): number {
  return term.length <= 3 ? 0 : term.length <= 5 ? 0.1 : 0.2;
}

type IndexedSearchDocument = { id: number } & Record<SearchField, string>;

/** What a hit needs from its Item after the build, without the Item itself. */
interface IndexedRecord {
  itemID: number;
  indexedKey: string;
  libraryID: number;
  title: string;
  /** The normalized citation key, or `null` when the Item has none. */
  citationKey: string | null;
  /** Position in the global order; see {@link orderComparator}. */
  order: number;
}

/**
 * A built search index over the Items of one or more Libraries. Opaque: read
 * it through {@link searchEngineIndex}.
 */
export interface EngineIndex {
  readonly size: number;
  /** @internal */
  readonly mini: MiniSearch<IndexedSearchDocument>;
  /** @internal Every record in global order. */
  readonly ordered: readonly IndexedRecord[];
  /** @internal */
  readonly byId: ReadonlyMap<number, IndexedRecord>;
  /** @internal The word splitter the index was built with, reused for queries. */
  readonly words: (text: string) => string[];
}

/** Accumulates an {@link EngineIndex} one slice of Items at a time. */
export interface EngineIndexBuilder {
  /** Index a slice of Items, then yield to the scheduler. */
  add(slice: readonly IndexedItem[]): Effect.Effect<void>;
  /** Impose the global order and return the index. */
  readonly build: Effect.Effect<EngineIndex>;
}

/** A builder over the words of the current {@link Segmenter}. */
export const makeEngineIndexBuilder = (
  options: EngineIndexOptions,
): Effect.Effect<EngineIndexBuilder, never, Segmenter> =>
  Effect.map(Effect.service(Segmenter), ({ words }) => {
    const core = createCore(words, options);
    return {
      add: (slice) =>
        Effect.andThen(
          Effect.sync(() => core.add(slice)),
          Effect.yieldNow,
        ),
      build: Effect.sync(() => core.build()),
    };
  });

/**
 * Build an index from a stream of Item slices. Each slice ends at a yield, so
 * an interrupt stops the build between slices and no index comes out.
 */
export const buildEngineIndex = <E, R>(
  slices: Stream.Stream<readonly IndexedItem[], E, R>,
  options: EngineIndexOptions,
): Effect.Effect<EngineIndex, E, R | Segmenter> =>
  Effect.gen(function* () {
    const builder = yield* makeEngineIndexBuilder(options);
    yield* Stream.runForEach(slices, (slice) => builder.add(slice));
    return yield* builder.build;
  });

/**
 * Rank the Items that match `query`, best first, up to `limit`.
 *
 * - Every query term must match some field, by prefix, and fuzzily when it is
 *   longer than three characters; MiniSearch's score orders the matches.
 * - Items whose citation key starts with the whole query come first, shortest
 *   key first.
 * - A bare Zotero key answers every Item holding that key.
 * - The empty query answers the global order: newest `dateModified` first,
 *   then canonical Library order, then item id. The same order breaks ties.
 *
 * The lookup and the ranking are separate steps with a yield between them, so
 * an interrupt can end a search mid-query.
 */
export const searchEngineIndex = (
  index: EngineIndex,
  query: string,
  limit: number,
): Effect.Effect<readonly ItemHit[]> =>
  Effect.gen(function* () {
    if (limit <= 0) return [];
    const lookup = lookupQuery(index, query, index.words);
    if (lookup.kind !== "ranked") return finishLookup(index, lookup, limit);
    yield* Effect.yieldNow;
    return finishLookup(index, lookup, limit);
  });

// ---------------------------------------------------------------------------
// Synchronous core behind the Effect API.

interface EngineCore {
  add(slice: readonly IndexedItem[]): void;
  build(): EngineIndex;
}

function createCore(
  words: (text: string) => string[],
  { libraries, languageLookup = null }: EngineIndexOptions,
): EngineCore {
  const mini = new MiniSearch<IndexedSearchDocument>({
    idField: "id",
    fields: [...SEARCH_FIELDS],
    storeFields: [],
    // The whole citation key is one term too, so the citation key rule can
    // find it by prefix wherever word segmentation would cut it.
    tokenize: (text, field) =>
      field === "citationKey" ? [text, ...words(text)] : words(text),
    processTerm,
  });
  const libraryRank = new Map(libraries.map((id, rank) => [id, rank]));
  const pending: { item: IndexedItem; record: IndexedRecord }[] = [];
  return {
    add(slice) {
      mini.addAll(
        slice.map((item) => {
          pending.push({
            item,
            record: {
              itemID: item.itemID,
              indexedKey: item.indexedKey,
              libraryID: item.libraryID,
              title: item.title ?? "",
              citationKey: item.citationKey
                ? normalize(item.citationKey)
                : null,
              order: 0,
            },
          });
          return toSearchDocument(item, languageLookup);
        }),
      );
    },
    build() {
      // Slices arrive one Library at a time, so the composite order is imposed
      // here rather than by insertion: one global sort over the whole corpus.
      const compare = orderComparator(libraryRank);
      pending.sort((a, b) => compare(a.item, b.item));
      const ordered = pending.map(({ record }, order) => {
        record.order = order;
        return record;
      });
      pending.length = 0;
      return {
        size: ordered.length,
        mini,
        ordered,
        byId: new Map(ordered.map((record) => [record.itemID, record])),
        words,
      };
    },
  };
}

/**
 * Canonical global order: most recently modified first, then canonical Library
 * order, then item id. Every ranking path ends here, so equal scores and equal
 * timestamps still produce one stable order across identical searches.
 */
function orderComparator(
  libraryRank: ReadonlyMap<number, number>,
): (a: IndexedItem, b: IndexedItem) => number {
  const rankOf = (item: IndexedItem): number =>
    libraryRank.get(item.libraryID) ?? libraryRank.size;
  return (a, b) =>
    b.dateModified.epochMilliseconds - a.dateModified.epochMilliseconds ||
    rankOf(a) - rankOf(b) ||
    a.itemID - b.itemID;
}

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

type Lookup =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "key"; records: IndexedRecord[] }
  | {
      kind: "ranked";
      /** The cleaned query, normalized, for the citation key rule. */
      whole: string;
      results: SearchResult[];
    };

function lookupQuery(
  index: EngineIndex,
  query: string,
  words: (text: string) => string[],
): Lookup {
  if (query.trim().length === 0) return { kind: "all" };
  const cleaned = cleanQuery(query);
  const keyQuery = cleaned.toUpperCase();
  if (ZOTERO_KEY_RE.test(keyQuery)) {
    // A bare Zotero Key is unique only inside one Library, so every Library in
    // scope that holds it contributes a result rather than the first one found.
    const records = index.mini
      .search(keyQuery.toLowerCase(), {
        fields: ["key"],
        prefix: false,
        fuzzy: false,
        tokenize: (text) => [text],
        processTerm: (term) => term,
      })
      .flatMap((result) => recordOf(index, result));
    return { kind: "key", records };
  }

  const tokens = queryTokens(cleaned, words);
  if (tokens.length === 0) return { kind: "none" };

  const whole = normalize(cleaned);
  // One lookup: every token across the fields, or the whole query as a
  // prefix of a whole citation key.
  const results = index.mini.search({
    combineWith: "OR",
    queries: [
      {
        queries: [cleaned],
        combineWith: "AND",
        prefix: true,
        fuzzy: fuzziness,
        boost: BOOSTS,
        tokenize: () => tokens,
        processTerm: (term) => term,
      },
      {
        queries: [whole],
        fields: ["citationKey"],
        prefix: true,
        fuzzy: false,
        tokenize: (text) => [text],
        processTerm: (term) => term,
      },
    ],
  });
  return { kind: "ranked", whole, results };
}

function finishLookup(
  index: EngineIndex,
  lookup: Lookup,
  limit: number,
): ItemHit[] {
  switch (lookup.kind) {
    case "all":
      return index.ordered.slice(0, limit).map((record) => hitOf(record, []));
    case "none":
      return [];
    case "key":
      return lookup.records
        .sort((a, b) => a.order - b.order)
        .slice(0, limit)
        .map((record) => hitOf(record, []));
    case "ranked":
      return rankResults(index, lookup, limit);
  }
}

interface RankedResult {
  record: IndexedRecord;
  score: number;
  terms: readonly string[];
  /** The citation key length when the key starts with the whole query. */
  keyLength: number | null;
}

function rankResults(
  index: EngineIndex,
  { whole, results }: Extract<Lookup, { kind: "ranked" }>,
  limit: number,
): ItemHit[] {
  const ranked: RankedResult[] = results.flatMap((result) =>
    recordOf(index, result).map((record) => ({
      record,
      score: result.score,
      terms: result.terms,
      keyLength: record.citationKey?.startsWith(whole)
        ? record.citationKey.length
        : null,
    })),
  );
  ranked.sort(compareRanked);
  const top = ranked.slice(0, limit);

  const terms = new Set<string>();
  for (const result of top) for (const term of result.terms) terms.add(term);
  const highlightRe = buildHighlightRegex(terms);

  return top.map(({ record }) =>
    hitOf(
      record,
      highlightRe && record.title
        ? highlightRanges(highlightRe, record.title)
        : [],
    ),
  );
}

function compareRanked(a: RankedResult, b: RankedResult): number {
  if (a.keyLength !== null || b.keyLength !== null) {
    if (a.keyLength === null) return 1;
    if (b.keyLength === null) return -1;
    return a.keyLength - b.keyLength || a.record.order - b.record.order;
  }
  return b.score - a.score || a.record.order - b.record.order;
}

function recordOf(index: EngineIndex, result: SearchResult): IndexedRecord[] {
  const record = index.byId.get(result.id as number);
  return record ? [record] : [];
}

function hitOf(record: IndexedRecord, matches: SearchMatches): ItemHit {
  return {
    itemID: record.itemID,
    indexedKey: record.indexedKey,
    libraryID: record.libraryID,
    matches,
  };
}

function queryTokens(
  query: string,
  words: (text: string) => string[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of words(query)) {
    const normalized = normalize(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function toSearchDocument(
  item: IndexedItem,
  languageLookup: LanguageNameLookup | null,
): IndexedSearchDocument {
  const language = parseItemLanguage(item.language, languageLookup);
  return {
    id: item.itemID,
    title: item.title ?? "",
    shortTitle: item.shortTitle ?? "",
    creators: item.creators
      .map((creator) => formatCreator(creator, language))
      .filter((name) => name.length > 0)
      .join("; "),
    publicationTitle: item.publicationTitle ?? "",
    court: item.court ?? "",
    citationKey: item.citationKey ?? "",
    key: item.key,
    year: parseItemDate(item.date)?.year?.toString() ?? "",
  };
}

function processTerm(term: string): string | null {
  const normalized = normalize(term);
  return normalized.length > 0 ? normalized : null;
}

// `result.terms` is the indexed terms that actually matched (after prefix
// and fuzzy expansion). `result.queryTerms` is the raw user input, which for
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
