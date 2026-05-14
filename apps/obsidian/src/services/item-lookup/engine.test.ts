import { describe, expect, it } from "vitest";
import type { Item } from "@zotlit/db";

import { buildIndex, searchIndex } from "./engine";
import { makeCreator as creator, makeItem as item } from "./fixtures";
import type { TokenizerOptions } from "./tokenizer";

describe("item lookup engine", () => {
  it("matches query terms across fields", () => {
    const target = item({
      key: "A",
      title: "Senior citizen transit ID cards",
      creators: [creator("Transit", "SEPTA")],
      date: "2015-01-01",
      citekey: "septa2015",
    });
    const hits = searchItems([target], "senior septa 2015");

    expect(hits[0]?.item.key).toBe("A");
  });

  it("requires every query token to match somewhere", () => {
    const target = item({
      key: "A",
      title: "Senior citizen transit ID cards",
      creators: [creator("Transit", "SEPTA")],
      date: "2015-01-01",
    });

    expect(searchItems([target], "senior nonexistent 2015")).toEqual([]);
  });

  it("ignores citekey when scoring matches", () => {
    const contentMatch = item({
      key: "A",
      title: "Senior citizen transit ID cards",
      creators: [creator("Transit", "SEPTA")],
      date: "2015-01-01",
      citekey: "unrelated",
    });
    const citekeyOnly = item({
      key: "B",
      title: "Other",
      citekey: "senior-septa-2015",
    });

    const hits = searchItems([citekeyOnly, contentMatch], "senior septa 2015");

    expect(hits.map((hit) => hit.item.key)).toEqual(["A"]);
  });

  it("returns no results for whitespace-only queries", () => {
    const target = item({
      key: "A",
      title: "Senior citizen transit ID cards",
    });
    const index = buildIndex([target], opts(), 1);

    expect(searchIndex(index, "   ", { tokenizer: opts(), limit: 50 })).toEqual(
      [],
    );
  });

  it("breaks score ties via a mild recency bonus", () => {
    // Two near-identical hits — same fields, same matches, different ages.
    // The recency multiplier (≤1.1×) is enough to reorder when relevance ties.
    const recent = item({
      key: "A",
      title: "Senior services overview",
      dateModified: now(),
    });
    const stale = item({
      key: "B",
      title: "Senior services overview",
      dateModified: yearsAgo(3),
    });
    const hits = searchItems([stale, recent], "senior services");

    expect(hits.map((hit) => hit.item.key)).toEqual(["A", "B"]);
  });

  it("returns title highlight ranges for matched query terms", () => {
    const target = item({
      key: "A",
      title: "Senior citizen transit ID cards",
      date: "2015-01-01",
    });
    const hits = searchItems([target], "senior 2015");

    expect(hits[0]?.matches).toEqual([[0, 6]]);
  });

  it("highlights matches across diacritic folding", () => {
    const target = item({
      key: "Jose2014",
      title:
        "Estudio de la infraestructura para la bicicleta en Málaga . " +
        "Diseño , movilidad y mejoras para transformarlo en una " +
        "infraestructura útil para el usuario .",
    });
    const hits = searchItems([target], "util");

    expect(hits).toHaveLength(1);
    const [match] = hits[0]!.matches;
    expect(match).toBeDefined();
    const [start, end] = match!;
    expect(target.title!.slice(start, end)).toBe("útil");
  });

  it("highlights fuzzy-matched indexed terms despite query typos", () => {
    // Regression: query `utilz` fuzzy-matches indexed `util` (from `útil`).
    // The user-typed token never appears in the title — highlight must
    // come from the matched indexed term, not from the raw query string.
    const target = item({
      key: "Jose2014",
      title:
        "Estudio de la infraestructura para la bicicleta en Málaga . " +
        "Diseño , movilidad y mejoras para transformarlo en una " +
        "infraestructura útil para el usuario .",
    });
    const hits = searchItems([target], "utilz");

    expect(hits).toHaveLength(1);
    const [match] = hits[0]!.matches;
    expect(match).toBeDefined();
    const [start, end] = match!;
    expect(target.title!.slice(start, end)).toBe("útil");
  });
});

function searchItems(items: readonly Item[], query: string) {
  const tokenizerOpts = opts();
  const index = buildIndex(items, tokenizerOpts, 1);
  return searchIndex(index, query, { tokenizer: tokenizerOpts, limit: 50 });
}

function opts(): TokenizerOptions {
  return {
    intl: new Intl.Segmenter(undefined, { granularity: "word" }),
  };
}

function now(): string {
  return Temporal.Now.instant().toString();
}

function yearsAgo(years: number): string {
  return Temporal.Now.instant()
    .subtract({ hours: years * 365 * 24 })
    .toString();
}
