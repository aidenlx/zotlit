// Search and facet filtering over the Template Directory's build-time index, as pure functions the index page runs in the browser.

import type {
  EntryFeature,
  EntryKind,
  EntryLevel,
  ResearchTask,
} from "./entry.ts";

/** What the index page knows of one Directory Entry: enough to find, filter, and list it. */
export interface IndexedEntry {
  /** `<kind folder>/<slug>`, which is also the entry page's path below the Directory. */
  readonly id: string;
  readonly kind: EntryKind;
  readonly level: EntryLevel;
  readonly title: string;
  readonly summary: string;
  readonly tasks: readonly ResearchTask[];
  /** Item types the entry is made for; empty for any item type. */
  readonly itemTypes: readonly string[];
  readonly features: readonly EntryFeature[];
  readonly problems: readonly string[];
  readonly keywords: readonly string[];
  readonly recommended: boolean;
}

export interface DirectoryQuery {
  /** Words as the reader typed them. */
  readonly text: string;
  readonly facets: Readonly<Partial<Record<Facet, readonly string[]>>>;
}

export const FACETS = ["task", "kind", "itemType", "feature", "level"] as const;

export type Facet = (typeof FACETS)[number];

/**
 * The entries that answer the query, best match first. When no entry holds
 * every searched word, the entries that hold the most of them answer, so a
 * question in the reader's own words still finds something. The facets then
 * narrow those answers, so a chosen value never brings in a weaker match.
 */
export function searchDirectory(
  entries: readonly IndexedEntry[],
  query: DirectoryQuery,
): IndexedEntry[] {
  const terms = searchTerms(query.text);
  const ranked = entries.map((entry) => ({ entry, ...rank(entry, terms) }));
  const best = Math.max(0, ...ranked.map(({ matched }) => matched));
  if (terms.length > 0 && best === 0) return [];
  const chosenTypes = query.facets.itemType ?? [];
  const madeFor = (entry: IndexedEntry) =>
    Number(entry.itemTypes.some((type) => chosenTypes.includes(type)));
  return ranked
    .filter(
      ({ entry, matched }) =>
        matched === best && fitsFacets(entry, query.facets),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        madeFor(b.entry) - madeFor(a.entry) ||
        byStanding(a.entry, b.entry),
    )
    .map(({ entry }) => entry);
}

/** The query as the index page's address carries it: `q` for the words, one comma-separated key per facet. */
export type DirectorySearch = Partial<Record<"q" | Facet, string>>;

export function queryFromSearch(
  search: Record<string, unknown>,
): DirectoryQuery {
  const facets: Partial<Record<Facet, string[]>> = {};
  for (const facet of FACETS) {
    const value = search[facet];
    if (typeof value !== "string") continue;
    const values = value.split(",").filter((part) => part !== "");
    if (values.length > 0) facets[facet] = values;
  }
  const { q } = search;
  const text =
    typeof q === "string" ? q : typeof q === "number" ? String(q) : "";
  return { text, facets };
}

export function searchFromQuery({
  text,
  facets,
}: DirectoryQuery): DirectorySearch {
  const search: DirectorySearch = {};
  if (text.trim() !== "") search.q = text.trim();
  for (const facet of FACETS) {
    const values = facets[facet] ?? [];
    if (values.length > 0) search[facet] = values.join(",");
  }
  return search;
}

/** Whether the reader has typed a word or chosen a facet value, which the address then carries. */
export function queryNarrows(query: DirectoryQuery): boolean {
  return Object.keys(searchFromQuery(query)).length > 0;
}

/**
 * For each facet value, how many entries the reader would see with that value
 * chosen and the other facets as they stand, so a choice that leaves nothing
 * shows as such before it is made.
 * @param options the values each facet offers
 */
export function facetCounts(
  entries: readonly IndexedEntry[],
  query: DirectoryQuery,
  options: Readonly<Record<Facet, readonly string[]>>,
): Record<Facet, Record<string, number>> {
  const count = (facet: Facet, value: string) =>
    searchDirectory(entries, {
      text: query.text,
      facets: { ...query.facets, [facet]: [value] },
    }).length;
  return Object.fromEntries(
    FACETS.map((facet) => [
      facet,
      Object.fromEntries(
        options[facet].map((value) => [value, count(facet, value)]),
      ),
    ]),
  ) as Record<Facet, Record<string, number>>;
}

/** The values an entry holds for a facet; null when it fits every value. */
function facetValues(
  entry: IndexedEntry,
  facet: Facet,
): readonly string[] | null {
  switch (facet) {
    case "task":
      return entry.tasks;
    case "kind":
      return [entry.kind];
    case "itemType":
      return entry.itemTypes.length > 0 ? entry.itemTypes : null;
    case "feature":
      return entry.features;
    case "level":
      return [entry.level];
  }
}

/** Any chosen value within a facet, and every facet with a choice. */
function fitsFacets(
  entry: IndexedEntry,
  facets: DirectoryQuery["facets"],
): boolean {
  return FACETS.every((facet) => {
    const chosen = facets[facet] ?? [];
    if (chosen.length === 0) return true;
    const values = facetValues(entry, facet);
    return values === null || values.some((value) => chosen.includes(value));
  });
}

/** How much each field says about an entry: its name most, its summary least. */
const FIELD_WEIGHTS = [
  [(entry: IndexedEntry) => [entry.title], 8],
  [(entry: IndexedEntry) => entry.keywords, 4],
  [(entry: IndexedEntry) => entry.problems, 3],
  [(entry: IndexedEntry) => [entry.summary], 2],
] as const;

/** Each entry's words by field, read once: facet counts search the index once per facet value. */
const fieldWords = new WeakMap<
  IndexedEntry,
  readonly (readonly [words: readonly string[], weight: number])[]
>();

function rank(
  entry: IndexedEntry,
  terms: readonly string[],
): { matched: number; score: number } {
  let fields = fieldWords.get(entry);
  if (fields === undefined) {
    fields = FIELD_WEIGHTS.map(
      ([text, weight]) => [words(text(entry).join(" ")), weight] as const,
    );
    fieldWords.set(entry, fields);
  }
  let matched = 0;
  let score = 0;
  for (const term of terms) {
    const weights = fields.flatMap(([held, weight]) =>
      held.some((word) => word.startsWith(term)) ? [weight] : [],
    );
    if (weights.length === 0) continue;
    matched += 1;
    score += Math.max(...weights);
  }
  return { matched, score };
}

/** Recommended entries first, then ready-to-use setups, then by title. */
function byStanding(a: IndexedEntry, b: IndexedEntry): number {
  return (
    Number(b.recommended) - Number(a.recommended) ||
    Number(b.level === "ready-to-use") - Number(a.level === "ready-to-use") ||
    a.title.localeCompare(b.title)
  );
}

/** Words that carry no meaning of their own in a reader's question. */
const STOP_WORDS = new Set(
  (
    "a an and are as at be but by can cannot d did didn do does doesn don for from get gets " +
    "has have how i if in into is isn it its ll m me my not of on or re s so t that the their " +
    "them then there these they this to too ve was we what when where which who why will " +
    "with won you your"
  ).split(" "),
);

/** The words a query searches for, each reduced to the form the index holds. */
function searchTerms(text: string): string[] {
  const all = words(text);
  const meaningful = all.filter((word) => !STOP_WORDS.has(word));
  return (meaningful.length > 0 ? meaningful : all).map(singular);
}

/** A plural's final "s" dropped, so the term also matches the singular as a prefix. */
function singular(term: string): string {
  return term.length > 3 && term.endsWith("s") && !term.endsWith("ss")
    ? term.slice(0, -1)
    : term;
}

/**
 * Lowercased words without accents, with British spellings folded to the
 * American ones the Directory's labels use.
 */
function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "")
    .map((word) =>
      word
        .replace(/^(col|behavi|fav)our/, "$1or")
        .replace(/(?<=\p{L}{3})is(e|ed|es|ing|ation)$/u, "iz$1"),
    );
}
