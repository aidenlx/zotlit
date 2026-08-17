// PROTOTYPE for https://github.com/aidenlx/zotlit/issues/697 — throwaway
// benchmark, run:
//   node --import ./packages/item-lookup/scripts/prototype-multi-library-bench/register.mjs packages/item-lookup/scripts/prototype-multi-library-bench/bench-multi-library-index.ts
//
// Compares a single "composite" MiniSearch index spanning all libraries
// against "per-library" indexes merged at query time. Prototype/probe code
// only — no tests, no abstractions.
import { writeFileSync } from "node:fs";

import type { IndexedItem } from "../../../db/src/queries/index-items.ts";
import type { Creator } from "../../../db/src/queries/items.ts";
import { Temporal } from "../../../shared/src/temporal.ts";
import { createIndexBuilder, searchIndex } from "../../src/engine.ts";
import type { SearchIndex } from "../../src/engine.ts";
import type { TokenizerOptions } from "../../src/tokenizer.ts";

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(42);
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}
function randInt(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// ---------------------------------------------------------------------------
// Synthetic word pools
// ---------------------------------------------------------------------------

const WORD_POOL = Array.from({ length: 300 }, (_, i) => `word${i}`);
// A handful of "real" English words mixed in so BM25 IDF is not perfectly
// uniform across the pool.
const COMMON_WORDS = [
  "the",
  "of",
  "and",
  "a",
  "in",
  "to",
  "on",
  "for",
  "with",
  "study",
  "analysis",
  "review",
  "system",
  "model",
  "network",
  "data",
  "theory",
  "method",
  "approach",
];
const TITLE_WORDS = [...WORD_POOL, ...COMMON_WORDS];

const FIRST_NAMES = [
  "James",
  "Mary",
  "Robert",
  "Patricia",
  "John",
  "Jennifer",
  "Michael",
  "Linda",
  "William",
  "Elizabeth",
  "David",
  "Barbara",
  "Richard",
  "Susan",
  "Joseph",
  "Jessica",
  "Thomas",
  "Sarah",
  "Charles",
  "Karen",
];
const LAST_NAMES = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Wilson",
  "Anderson",
  "Taylor",
  "Thomas",
  "Moore",
];
const PUBLICATIONS = [
  "Journal of Applied Science",
  "Nature Reviews",
  "Proceedings of the Annual Conference",
  "International Review",
  "Studies Quarterly",
];

function randomTitle(wordCount: number): string {
  return Array.from({ length: wordCount }, () => pick(TITLE_WORDS)).join(" ");
}

function randomCreators(): Creator[] {
  const n = randInt(1, 4);
  return Array.from({ length: n }, () => ({
    firstName: pick(FIRST_NAMES),
    lastName: pick(LAST_NAMES),
    creatorType: "author",
    fieldMode: 0 as const,
  }));
}

const NOW = Temporal.Now.instant();
const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000;

function randomDateModified(): Temporal.Instant {
  const offsetMs = randInt(0, THREE_YEARS_MS);
  return NOW.subtract({ milliseconds: offsetMs });
}

let nextItemID = 1;

interface GenOptions {
  libraryID: number;
  count: number;
  citationKeyRatio?: number;
  /** Extra items appended after the random ones (for the IDF-skew probe). */
}

function generateItems(opts: GenOptions): IndexedItem[] {
  const items: IndexedItem[] = [];
  for (let i = 0; i < opts.count; i++) {
    const itemID = nextItemID++;
    const key = itemID.toString(36).toUpperCase().padStart(8, "0");
    const hasCitationKey = rng() < (opts.citationKeyRatio ?? 0.4);
    items.push({
      itemID,
      libraryID: opts.libraryID,
      key,
      indexedKey: key,
      dateModified: randomDateModified(),
      itemType: "journalArticle",
      primaryCreator: null,
      creators: randomCreators(),
      language: null,
      title: randomTitle(randInt(4, 10)),
      publicationTitle: pick(PUBLICATIONS),
      shortTitle: null,
      court: null,
      citationKey: hasCitationKey
        ? `${pick(LAST_NAMES).toLowerCase()}${randInt(2000, 2025)}`
        : null,
      date: `${randInt(2000, 2025)}`,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// IDF-skew probe: "quantum" appears in ~15% of lib-1 titles (short titles,
// strong match) but exactly once in lib-5 (long title, weak match).
// ---------------------------------------------------------------------------

const PROBE_TERM = "quantum";
const PROBE_QUERY = "quantum network";

function plantProbe(lib1Items: IndexedItem[], lib5Items: IndexedItem[]): void {
  // ~15% of lib1 items get a short title containing the probe term plus the
  // second query term "network" -> strong matches.
  const probeCount = Math.round(lib1Items.length * 0.15);
  for (let i = 0; i < probeCount; i++) {
    const item = lib1Items[i]!;
    item.title = `${PROBE_TERM} network ${randomTitle(randInt(1, 3))}`;
  }
  // Exactly one lib5 item: both query terms appear once each, buried in a
  // long title (weak BM25 evidence vs. the short, term-dense lib1 titles).
  const weakItem = lib5Items[0]!;
  weakItem.title = `${randomTitle(3)} ${PROBE_TERM} ${randomTitle(3)} network ${randomTitle(3)}`;
}

// ---------------------------------------------------------------------------
// Index building
// ---------------------------------------------------------------------------

const tokenizerOpts: TokenizerOptions = {
  intl: new Intl.Segmenter("en", { granularity: "word" }),
  chsSegmenter: null,
};

function buildComposite(allItems: readonly IndexedItem[]): {
  index: SearchIndex;
  ms: number;
} {
  const start = performance.now();
  const builder = createIndexBuilder(tokenizerOpts, { libraryID: 0 });
  builder.add(allItems);
  const index = builder.build();
  const ms = performance.now() - start;
  return { index, ms };
}

function buildPerLibrary(
  libraries: { libraryID: number; items: IndexedItem[] }[],
): {
  indexes: Map<number, SearchIndex>;
  msByLib: Map<number, number>;
} {
  const indexes = new Map<number, SearchIndex>();
  const msByLib = new Map<number, number>();
  for (const lib of libraries) {
    const start = performance.now();
    const builder = createIndexBuilder(tokenizerOpts, {
      libraryID: lib.libraryID,
    });
    builder.add(lib.items);
    indexes.set(lib.libraryID, builder.build());
    msByLib.set(lib.libraryID, performance.now() - start);
  }
  return { indexes, msByLib };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

const LIMIT = 50;

function queryComposite(index: SearchIndex, query: string) {
  return searchIndex(index, query, { tokenizer: tokenizerOpts, limit: LIMIT });
}

function queryPerLibraryMerged(
  indexes: Map<number, SearchIndex>,
  query: string,
) {
  const allHits = [...indexes.values()].flatMap((index) =>
    searchIndex(index, query, { tokenizer: tokenizerOpts, limit: LIMIT }),
  );
  allHits.sort((a, b) => b.score - a.score);
  return allHits.slice(0, LIMIT);
}

function queryPerLibraryMergedEmpty(indexes: Map<number, SearchIndex>) {
  // Empty-query path: merge per-library dateModified-desc lists.
  // searchIndex returns [] for empty query, so build the dateModified-desc
  // lists directly, same as the composite's fallback would.
  const allItems = [...indexes.values()].flatMap((index) => index.items);
  allItems.sort(
    (a, b) =>
      b.dateModified.epochMilliseconds - a.dateModified.epochMilliseconds,
  );
  return allItems.slice(0, LIMIT);
}

function compositeEmptyQuery(index: SearchIndex) {
  const items = [...index.items];
  items.sort(
    (a, b) =>
      b.dateModified.epochMilliseconds - a.dateModified.epochMilliseconds,
  );
  return items.slice(0, LIMIT);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function timeMedian(fn: () => void, runs = 9): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return median(times);
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

const lines: string[] = [];
function log(line = ""): void {
  lines.push(line);
  console.log(line);
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

interface ScenarioResult {
  name: string;
  libSizes: number[];
  compositeBuildMs: number;
  perLibBuildMsByLib: number[];
  perLibBuildSumMs: number;
  invalidationLargestMs: number;
  invalidationSmallestMs: number;
  invalidationCompositeMs: number;
  queryResults: {
    query: string;
    compositeMedianMs: number;
    perLibMedianMs: number;
    overlapTop20: number;
    firstDivergenceRank: number | null;
  }[];
}

function runScenario(
  name: string,
  libSizes: number[],
  plantIdfProbe: boolean,
): {
  result: ScenarioResult;
  probeNotes: string[];
} {
  const libraries = libSizes.map((count, i) => ({
    libraryID: i + 1,
    items: generateItems({ libraryID: i + 1, count }),
  }));

  const probeNotes: string[] = [];
  if (plantIdfProbe) {
    plantProbe(libraries[0]!.items, libraries[libraries.length - 1]!.items);
  }

  const allItems = libraries.flatMap((lib) => lib.items);

  // --- Build time ---
  const { index: compositeIndex, ms: compositeBuildMs } =
    buildComposite(allItems);
  const { indexes: perLibIndexes, msByLib } = buildPerLibrary(libraries);
  const perLibBuildMsByLib = libraries.map(
    (lib) => msByLib.get(lib.libraryID)!,
  );
  const perLibBuildSumMs = perLibBuildMsByLib.reduce((a, b) => a + b, 0);

  // --- Invalidation cost (rebuild largest and smallest lib) ---
  const largestLib = libraries[0]!; // libraries sorted largest-first by caller
  const smallestLib = libraries[libraries.length - 1]!;
  const invalidationLargestMs = timeMedian(() => {
    const builder = createIndexBuilder(tokenizerOpts, {
      libraryID: largestLib.libraryID,
    });
    builder.add(largestLib.items);
    builder.build();
  }, 3);
  const invalidationSmallestMs = timeMedian(() => {
    const builder = createIndexBuilder(tokenizerOpts, {
      libraryID: smallestLib.libraryID,
    });
    builder.add(smallestLib.items);
    builder.build();
  }, 3);
  const invalidationCompositeMs = timeMedian(() => {
    buildComposite(allItems);
  }, 3);

  // --- Queries ---
  // Use the planted probe query only when this scenario has the probe;
  // otherwise take a genuine 2-word snippet from a generated title so the
  // query actually matches something in this scenario's word pool.
  const probeTitleQuery = plantIdfProbe
    ? PROBE_QUERY
    : allItems[0]!.title!.split(" ").slice(0, 2).join(" ");
  const authorQuery = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
  const prefixQuery = TITLE_WORDS[0]!.slice(0, 3);
  const citationKeyish =
    allItems.find((it) => it.citationKey)?.citationKey ?? "smith2020";
  const queries = [
    {
      label: "probe-title (2-word, contains probe term)",
      query: probeTitleQuery,
    },
    { label: "author-name", query: authorQuery },
    { label: "3-char prefix", query: prefixQuery },
    { label: "citation-key-ish", query: citationKeyish },
    { label: "empty query", query: "" },
  ];

  const queryResults: ScenarioResult["queryResults"] = [];
  for (const { label, query } of queries) {
    const isEmpty = query === "";
    const compositeMedianMs = timeMedian(() =>
      isEmpty
        ? compositeEmptyQuery(compositeIndex)
        : queryComposite(compositeIndex, query),
    );
    const perLibMedianMs = timeMedian(() =>
      isEmpty
        ? queryPerLibraryMergedEmpty(perLibIndexes)
        : queryPerLibraryMerged(perLibIndexes, query),
    );

    const compositeHits = isEmpty
      ? compositeEmptyQuery(compositeIndex).map((item) => ({ item, score: 0 }))
      : queryComposite(compositeIndex, query);
    const perLibHits = isEmpty
      ? queryPerLibraryMergedEmpty(perLibIndexes).map((item) => ({
          item,
          score: 0,
        }))
      : queryPerLibraryMerged(perLibIndexes, query);

    const compositeTop20 = compositeHits.slice(0, 20).map((h) => h.item.itemID);
    const perLibTop20 = perLibHits.slice(0, 20).map((h) => h.item.itemID);
    const perLibSet = new Set(perLibTop20);
    const overlapTop20 = compositeTop20.filter((id) =>
      perLibSet.has(id),
    ).length;

    let firstDivergenceRank: number | null = null;
    const compositeIds = compositeHits.map((h) => h.item.itemID);
    const perLibIds = perLibHits.map((h) => h.item.itemID);
    for (let i = 0; i < Math.min(compositeIds.length, perLibIds.length); i++) {
      if (compositeIds[i] !== perLibIds[i]) {
        firstDivergenceRank = i;
        break;
      }
    }

    queryResults.push({
      query: label,
      compositeMedianMs,
      perLibMedianMs,
      overlapTop20,
      firstDivergenceRank,
    });

    if (plantIdfProbe && label.startsWith("probe-title")) {
      // Concrete IDF-skew numbers.
      const weakLibID = libraries[libraries.length - 1]!.libraryID;
      const weakIndex = perLibIndexes.get(weakLibID)!;
      const weakHitsOwnIndex = searchIndex(weakIndex, PROBE_QUERY, {
        tokenizer: tokenizerOpts,
        limit: LIMIT,
      });
      const weakItem = libraries[libraries.length - 1]!.items[0]!;
      const weakOwnScore = weakHitsOwnIndex.find(
        (h) => h.item.itemID === weakItem.itemID,
      )?.score;

      const strongLibID = libraries[0]!.libraryID;
      const strongIndex = perLibIndexes.get(strongLibID)!;
      const strongHitsOwnIndex = searchIndex(strongIndex, PROBE_QUERY, {
        tokenizer: tokenizerOpts,
        limit: LIMIT,
      });
      const strongTop3 = strongHitsOwnIndex.slice(0, 3);

      const mergedRankOfWeak = perLibHits.findIndex(
        (h) => h.item.itemID === weakItem.itemID,
      );
      const compositeRankOfWeak = compositeHits.findIndex(
        (h) => h.item.itemID === weakItem.itemID,
      );
      const mergedRankOfStrong0 = strongTop3[0]
        ? perLibHits.findIndex(
            (h) => h.item.itemID === strongTop3[0]!.item.itemID,
          )
        : -1;
      const compositeRankOfStrong0 = strongTop3[0]
        ? compositeHits.findIndex(
            (h) => h.item.itemID === strongTop3[0]!.item.itemID,
          )
        : -1;

      probeNotes.push(
        `- Probe query: \`${PROBE_QUERY}\``,
        `- Weak lib-${weakLibID} item (itemID ${weakItem.itemID}, title: "${weakItem.title}") score in its own tiny index: ${weakOwnScore ?? "not matched"}`,
        `- Top 3 strong lib-${strongLibID} items in their own index: ${strongTop3
          .map(
            (h) =>
              `itemID ${h.item.itemID} score ${h.score.toFixed(4)} ("${h.item.title}")`,
          )
          .join("; ")}`,
        `- Naive merge rank of weak item: ${mergedRankOfWeak === -1 ? `not in top ${LIMIT}` : mergedRankOfWeak}`,
        `- Composite rank of weak item: ${compositeRankOfWeak === -1 ? `not in top ${LIMIT}` : compositeRankOfWeak}`,
        `- Naive merge rank of top strong item (itemID ${strongTop3[0]?.item.itemID}): ${mergedRankOfStrong0}`,
        `- Composite rank of same top strong item: ${compositeRankOfStrong0}`,
      );
    }
  }

  return {
    result: {
      name,
      libSizes,
      compositeBuildMs,
      perLibBuildMsByLib,
      perLibBuildSumMs,
      invalidationLargestMs,
      invalidationSmallestMs,
      invalidationCompositeMs,
      queryResults,
    },
    probeNotes,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

log("# Multi-library search-index benchmark (issue #697)");
log();
log("## Machine note");
log();
log(`- Node: ${process.version}`);
log(`- Platform: ${process.platform} ${process.arch}`);
log(`- Date: ${new Date().toISOString()}`);
log();
log("## Dataset");
log();
log("- Heavy-user scenario library sizes: 20000 / 5000 / 1000 / 200 / 50");
log("- Typical scenario library sizes: 3000 / 800 / 150");
log(
  "- Titles: 4-10 words from a 300-word synthetic pool plus ~19 common English words; creators from a 15x20 name pool; publicationTitle from a 5-item pool; dateModified spread uniformly over the past 3 years; ~40% of items get a citation key.",
);
log(
  `- IDF-skew probe (heavy scenario only): term \`${PROBE_TERM}\` planted in ~15% of lib-1 titles (short 3-word titles, e.g. "quantum network word12") and in exactly one lib-5 item (long 11-word title, both query terms appear once each, buried far apart). Probe query: \`${PROBE_QUERY}\`.`,
);
log();

const heavy = runScenario(
  "Heavy-user (20000/5000/1000/200/50)",
  [20000, 5000, 1000, 200, 50],
  true,
);
const typical = runScenario("Typical (3000/800/150)", [3000, 800, 150], false);

log("## 1. Build time");
log();
log(
  "| Scenario | Composite full build (ms) | Per-library builds (ms) | Per-library sum (ms) |",
);
log("| --- | --- | --- | --- |");
for (const { result } of [heavy, typical]) {
  const perLib = result.libSizes
    .map(
      (size, i) =>
        `lib${i + 1}(${size})=${result.perLibBuildMsByLib[i]!.toFixed(1)}`,
    )
    .join(", ");
  log(
    `| ${result.name} | ${result.compositeBuildMs.toFixed(1)} | ${perLib} | ${result.perLibBuildSumMs.toFixed(1)} |`,
  );
}
log();

log("## 2. Invalidation cost (derived)");
log();
log(
  "Composite invalidation = full rebuild of all libraries. Per-library invalidation = rebuild of only the changed library. Median of 3 rebuilds.",
);
log();
log(
  "| Scenario | Composite full rebuild (ms) | Per-library rebuild, largest lib (ms) | Per-library rebuild, smallest lib (ms) |",
);
log("| --- | --- | --- | --- |");
for (const { result } of [heavy, typical]) {
  log(
    `| ${result.name} | ${result.invalidationCompositeMs.toFixed(1)} | ${result.invalidationLargestMs.toFixed(1)} | ${result.invalidationSmallestMs.toFixed(1)} |`,
  );
}
log();

log("## 3. Query latency (warm, median of 9 runs, limit 50)");
log();
log(
  "| Scenario | Query | Composite median (ms) | Per-library merged median (ms) |",
);
log("| --- | --- | --- | --- |");
for (const { result } of [heavy, typical]) {
  for (const q of result.queryResults) {
    log(
      `| ${result.name} | ${q.query} | ${q.compositeMedianMs.toFixed(3)} | ${q.perLibMedianMs.toFixed(3)} |`,
    );
  }
}
log();

log("## 4. Ranking fidelity (composite ordering treated as ground truth)");
log();
log("| Scenario | Query | Top-20 overlap (of 20) | First divergence rank |");
log("| --- | --- | --- | --- |");
for (const { result } of [heavy, typical]) {
  for (const q of result.queryResults) {
    log(
      `| ${result.name} | ${q.query} | ${q.overlapTop20} | ${q.firstDivergenceRank ?? "none observed"} |`,
    );
  }
}
log();

log("## Raw observations: IDF-skew probe (heavy scenario)");
log();
for (const n of heavy.probeNotes) log(n);
log();

const report = `${lines.join("\n")}\n`;
writeFileSync(new URL("./results.md", import.meta.url), report);
