// Run with `pnpm --filter @zotlit/item-lookup bench`; it stays out of
// `pnpm test` because it builds a 100,000-Item index and checks a time bound.
import { Effect, Stream } from "effect";
import MiniSearch from "minisearch";
import { afterEach, describe, expect, it, vi } from "vitest";

import { USER_LIBRARY_ID } from "@zotlit/db";
import type { IndexedItem } from "@zotlit/db";

import { buildEngineIndex, searchEngineIndex } from "./engine";
import type { EngineIndex } from "./engine";
import { makeCreator, makeIndexedItem } from "./fixtures";
import { layerSegmenterNone } from "./segmenter";

const ITEMS = 100_000;
const SLICE = 500;
/** Wall-clock bound for one query; ADR 0069 measured ~170 ms in Obsidian. */
const QUERY_BOUND_MS = 500;

const WORDS = [
  "analysis",
  "archive",
  "behaviour",
  "climate",
  "data",
  "economy",
  "history",
  "language",
  "learning",
  "memory",
  "network",
  "policy",
  "society",
  "theory",
  "urban",
  "values",
];
const NAMES = ["Smith", "Garcia", "Chen", "Müller", "Okafor", "Novak"];

describe("search cost over 100,000 Items", () => {
  let index: EngineIndex;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds the index", async () => {
    index = await buildEngineIndex(Stream.fromIterable(slices()), {
      libraries: [USER_LIBRARY_ID],
    }).pipe(Effect.provide(layerSegmenterNone), Effect.runPromise);
    expect(index.size).toBe(ITEMS);
  }, 120_000);

  it.each(["a", "s", "smith 20 his"])(
    "answers %j with one MiniSearch lookup within the bound",
    async (query) => {
      const lookups = vi.spyOn(MiniSearch.prototype, "search");
      const t0 = performance.now();
      const hits = await Effect.runPromise(searchEngineIndex(index, query, 50));
      const elapsed = performance.now() - t0;

      console.info(`${JSON.stringify(query)}: ${elapsed.toFixed(1)} ms`);
      expect(hits.length).toBeGreaterThan(0);
      expect(lookups).toHaveBeenCalledTimes(1);
      expect(elapsed).toBeLessThan(QUERY_BOUND_MS);
    },
  );
});

function* slices(): Generator<IndexedItem[]> {
  for (let start = 0; start < ITEMS; start += SLICE) {
    const slice: IndexedItem[] = [];
    for (let id = start; id < Math.min(start + SLICE, ITEMS); id++) {
      slice.push(synthetic(id));
    }
    yield slice;
  }
}

function synthetic(id: number): IndexedItem {
  const word = (n: number) => WORDS[(id * 7 + n * 13) % WORDS.length]!;
  const name = NAMES[id % NAMES.length]!;
  const year = 1990 + (id % 35);
  return makeIndexedItem({
    key: id.toString(36).toUpperCase().padStart(8, "0"),
    itemID: id + 1,
    title: `${word(0)} ${word(1)} and ${word(2)} ${id}`,
    creators: [makeCreator("A.", name)],
    date: `${year}-01-01`,
    citationKey: `${name.toLowerCase()}${year}${word(0)}`,
    publicationTitle: `Journal of ${word(3)}`,
    dateModified: new Date(Date.UTC(2020, 0, 1) + id * 60_000).toISOString(),
  });
}
