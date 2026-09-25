import { describe, expect, it } from "vitest";

import type { AnnotationRecord } from "@/services/annotation-repository/service";

import {
  cappedSelection,
  deriveSwatchColors,
  deriveTagChips,
  filterAnnotations,
  isFilterActive,
  sanitizeSavedFilter,
} from "./filter";
import type { AnnotFilter } from "./filter";

function makeAnnot(
  overrides: Partial<AnnotationRecord> = {},
): AnnotationRecord {
  return {
    key: "AAAAAAAA",
    type: "highlight",
    text: null,
    comment: null,
    color: null,
    pageLabel: null,
    sortIndex: "00000|000000|00000",
    parentKey: "PPPPPPPP",
    tags: [],
    position: { kind: "unknown", raw: null },
    version: null,
    ...overrides,
  };
}

const NO_FILTER: AnnotFilter = { query: "", colors: [], tags: [] };

describe("isFilterActive", () => {
  it("is false when all groups are empty", () => {
    expect(isFilterActive(NO_FILTER)).toBe(false);
  });

  it("is true when any group is non-empty", () => {
    expect(isFilterActive({ ...NO_FILTER, query: "x" })).toBe(true);
    expect(isFilterActive({ ...NO_FILTER, colors: ["#FFD400"] })).toBe(true);
    expect(isFilterActive({ ...NO_FILTER, tags: ["a"] })).toBe(true);
  });
});

describe("filterAnnotations", () => {
  it("passes everything through when the filter is empty", () => {
    const annots = [
      makeAnnot({ key: "AAAAAAAA" }),
      makeAnnot({ key: "BBBBBBBB" }),
    ];
    expect(filterAnnotations(annots, NO_FILTER)).toEqual(annots);
  });

  it("matches query against text, case-insensitively", () => {
    const a = makeAnnot({ key: "AAAAAAAA", text: "Hello World" });
    const b = makeAnnot({ key: "BBBBBBBB", text: "Nothing here" });
    const result = filterAnnotations([a, b], {
      ...NO_FILTER,
      query: "hello",
    });
    expect(result).toEqual([a]);
  });

  it("matches query against HTML-stripped comment", () => {
    const a = makeAnnot({
      key: "AAAAAAAA",
      comment: "<p>See <b>methodology</b> section</p>",
    });
    const b = makeAnnot({ key: "BBBBBBBB", comment: "<p>unrelated</p>" });
    const result = filterAnnotations([a, b], {
      ...NO_FILTER,
      query: "methodology",
    });
    expect(result).toEqual([a]);
  });

  it("matches query against a tag name", () => {
    const a = makeAnnot({
      key: "AAAAAAAA",
      tags: ["Methodology"],
    });
    const b = makeAnnot({ key: "BBBBBBBB", tags: ["Other"] });
    const result = filterAnnotations([a, b], {
      ...NO_FILTER,
      query: "methodo",
    });
    expect(result).toEqual([a]);
  });

  it("matches query against pageLabel", () => {
    const a = makeAnnot({ key: "AAAAAAAA", pageLabel: "42" });
    const b = makeAnnot({ key: "BBBBBBBB", pageLabel: "7" });
    const result = filterAnnotations([a, b], { ...NO_FILTER, query: "42" });
    expect(result).toEqual([a]);
  });

  it("matches a lowercase DB color against a canonical uppercase filter color", () => {
    const a = makeAnnot({ key: "AAAAAAAA", color: "#ffd400" });
    const result = filterAnnotations([a], {
      ...NO_FILTER,
      colors: ["#FFD400"],
    });
    expect(result).toEqual([a]);
  });

  it("excludes a null-color annotation when a color filter is active", () => {
    const a = makeAnnot({ key: "AAAAAAAA", color: null });
    const result = filterAnnotations([a], {
      ...NO_FILTER,
      colors: ["#FFD400"],
    });
    expect(result).toEqual([]);
  });

  it("includes a null-color annotation when the color group is empty", () => {
    const a = makeAnnot({ key: "AAAAAAAA", color: null });
    expect(filterAnnotations([a], NO_FILTER)).toEqual([a]);
  });

  it("ORs within the colors group", () => {
    const yellow = makeAnnot({ key: "AAAAAAAA", color: "#FFD400" });
    const red = makeAnnot({ key: "BBBBBBBB", color: "#FF6666" });
    const green = makeAnnot({ key: "CCCCCCCC", color: "#5FB236" });
    const result = filterAnnotations([yellow, red, green], {
      ...NO_FILTER,
      colors: ["#FFD400", "#FF6666"],
    });
    expect(result).toEqual([yellow, red]);
  });

  it("ORs within the tags group", () => {
    const a = makeAnnot({ key: "AAAAAAAA", tags: ["a"] });
    const b = makeAnnot({ key: "BBBBBBBB", tags: ["b"] });
    const c = makeAnnot({ key: "CCCCCCCC", tags: ["c"] });
    const result = filterAnnotations([a, b, c], {
      ...NO_FILTER,
      tags: ["a", "b"],
    });
    expect(result).toEqual([a, b]);
  });

  it("matches a tag filter by name", () => {
    const a = makeAnnot({ key: "AAAAAAAA", tags: ["Methodology"] });
    const b = makeAnnot({ key: "BBBBBBBB", tags: ["Other"] });
    const result = filterAnnotations([a, b], {
      ...NO_FILTER,
      tags: ["Methodology"],
    });
    expect(result).toEqual([a]);
  });

  it("passes colored annotations through an empty colors group", () => {
    const yellow = makeAnnot({ key: "AAAAAAAA", color: "#ffd400" });
    const green = makeAnnot({ key: "BBBBBBBB", color: "#5FB236" });
    const none = makeAnnot({ key: "CCCCCCCC", color: null });
    expect(filterAnnotations([yellow, green, none], NO_FILTER)).toEqual([
      yellow,
      green,
      none,
    ]);
  });

  it("passes colored annotations when only the colors group is empty, under an active tag or query filter", () => {
    const yellow = makeAnnot({
      key: "AAAAAAAA",
      color: "#ffd400",
      text: "the methodology approach",
      tags: ["Methodology"],
    });
    const green = makeAnnot({
      key: "BBBBBBBB",
      color: "#5FB236",
      text: "the methodology approach",
      tags: ["Methodology"],
    });
    const result = filterAnnotations([yellow, green], {
      ...NO_FILTER,
      query: "methodology",
      tags: ["Methodology"],
    });
    expect(result).toEqual([yellow, green]);
  });

  it("ANDs across groups: color AND tag AND query", () => {
    const match = makeAnnot({
      key: "AAAAAAAA",
      color: "#ffd400",
      tags: ["Methodology"],
      text: "the methodology approach",
    });
    const wrongColor = makeAnnot({
      key: "BBBBBBBB",
      color: "#FF6666",
      tags: ["Methodology"],
      text: "the methodology approach",
    });
    const wrongTag = makeAnnot({
      key: "CCCCCCCC",
      color: "#ffd400",
      tags: ["Other"],
      text: "the methodology approach",
    });
    const wrongQuery = makeAnnot({
      key: "DDDDDDDD",
      color: "#ffd400",
      tags: ["Other Tag"],
      text: "unrelated text",
    });
    const filter: AnnotFilter = {
      query: "methodology",
      colors: ["#FFD400"],
      tags: ["Methodology"],
    };
    const result = filterAnnotations(
      [match, wrongColor, wrongTag, wrongQuery],
      filter,
    );
    expect(result).toEqual([match]);
  });
});

describe("deriveSwatchColors", () => {
  it("orders colors by the reader palette and appends unknown colors in first-seen order", () => {
    const annots = [
      makeAnnot({ key: "AAAAAAAA", color: "#A6507B" }),
      makeAnnot({ key: "BBBBBBBB", color: "#5FB236" }),
      makeAnnot({ key: "CCCCCCCC", color: "#FFD400" }),
      makeAnnot({ key: "DDDDDDDD", color: null }),
      makeAnnot({ key: "EEEEEEEE", color: "#ffd400" }),
    ];
    expect(deriveSwatchColors(annots)).toEqual([
      "#FFD400",
      "#5FB236",
      "#A6507B",
    ]);
  });
});

describe("sanitizeSavedFilter", () => {
  const annots = [
    makeAnnot({
      key: "AAAAAAAA",
      color: "#FFD400",
      tags: ["Methodology"],
    }),
    makeAnnot({
      key: "BBBBBBBB",
      color: "#5FB236",
      tags: ["Other"],
    }),
  ];

  it("roundtrips a valid saved selection, pruning colors/tags no longer present", () => {
    const raw = JSON.stringify({
      colors: ["#FFD400", "#AAAAAA"],
      tags: ["Methodology", "Vanished"],
    });
    expect(sanitizeSavedFilter(raw, annots)).toEqual({
      colors: ["#FFD400"],
      tags: ["Methodology"],
    });
  });

  it("canonicalizes a lowercase saved color against uppercase annotation colors", () => {
    const raw = JSON.stringify({ colors: ["#ffd400"], tags: [] });
    expect(sanitizeSavedFilter(raw, annots)).toEqual({
      colors: ["#FFD400"],
      tags: [],
    });
  });

  it("returns null for undefined input", () => {
    expect(sanitizeSavedFilter(undefined, annots)).toBeNull();
  });

  it("returns null for a non-JSON string", () => {
    expect(sanitizeSavedFilter("not json", annots)).toBeNull();
  });

  it("returns null for JSON that parses to a non-object", () => {
    expect(sanitizeSavedFilter("42", annots)).toBeNull();
    expect(sanitizeSavedFilter("null", annots)).toBeNull();
    expect(sanitizeSavedFilter("[1,2]", annots)).toBeNull();
  });

  it("returns null when fields have the wrong shape", () => {
    expect(
      sanitizeSavedFilter(JSON.stringify({ colors: "x" }), annots),
    ).toBeNull();
    expect(
      sanitizeSavedFilter(JSON.stringify({ colors: ["x"], tags: "y" }), annots),
    ).toBeNull();
  });

  it("returns null for a pre-migration saved filter whose tags are still numeric ids", () => {
    const raw = JSON.stringify({ colors: [], tags: [1, 2] });
    expect(sanitizeSavedFilter(raw, annots)).toBeNull();
  });

  it("returns null when everything is pruned away", () => {
    const raw = JSON.stringify({ colors: ["#AAAAAA"], tags: ["Vanished"] });
    expect(sanitizeSavedFilter(raw, annots)).toBeNull();
  });
});

describe("deriveTagChips", () => {
  it("orders by hit count descending, then by name", () => {
    const annots = [
      makeAnnot({ key: "AAAAAAAA", tags: ["Mango", "Zebra", "Apple"] }),
      makeAnnot({ key: "BBBBBBBB", tags: ["Mango", "Zebra"] }),
      makeAnnot({ key: "CCCCCCCC", tags: ["Mango"] }),
    ];
    const chips = deriveTagChips(annots, NO_FILTER);
    expect(chips.map((c) => [c.name, c.hitCount])).toEqual([
      ["Mango", 3],
      ["Zebra", 2],
      ["Apple", 1],
    ]);
  });

  it("dedupes tags and keeps its order regardless of selection", () => {
    const annots = [
      makeAnnot({
        key: "AAAAAAAA",
        tags: ["Zebra", "Apple"],
      }),
      makeAnnot({
        key: "BBBBBBBB",
        tags: ["Apple", "Mango"],
      }),
    ];
    const chips = deriveTagChips(annots, { ...NO_FILTER, tags: ["Mango"] });
    expect(chips.map((c) => c.name)).toEqual(["Apple", "Mango", "Zebra"]);
    expect(chips.map((c) => c.selected)).toEqual([false, true, false]);
  });

  it("marks availability against color+query groups only, ignoring the tag group", () => {
    const annots = [
      makeAnnot({
        key: "AAAAAAAA",
        color: "#FFD400",
        tags: ["Yellow Tag"],
      }),
      makeAnnot({
        key: "BBBBBBBB",
        color: "#FF6666",
        tags: ["Red Tag"],
      }),
    ];
    const chips = deriveTagChips(annots, {
      ...NO_FILTER,
      colors: ["#FFD400"],
    });
    const byName = new Map(chips.map((c) => [c.name, c]));
    expect(byName.get("Yellow Tag")?.hitCount).toBe(1);
    expect(byName.get("Yellow Tag")?.available).toBe(true);
    expect(byName.get("Red Tag")?.hitCount).toBe(0);
    expect(byName.get("Red Tag")?.available).toBe(false);
  });

  it("counts colored annotations toward hitCount when the colors group is empty", () => {
    const annots = [
      makeAnnot({
        key: "AAAAAAAA",
        color: "#FFD400",
        tags: ["Yellow Tag"],
      }),
      makeAnnot({
        key: "BBBBBBBB",
        color: "#5FB236",
        tags: ["Yellow Tag"],
      }),
    ];
    const chips = deriveTagChips(annots, NO_FILTER);
    expect(chips[0]).toMatchObject({
      name: "Yellow Tag",
      hitCount: 2,
      available: true,
    });
  });

  it("keeps a selected tag with zero current hits, marked unavailable", () => {
    const annots = [
      makeAnnot({
        key: "AAAAAAAA",
        color: "#FF6666",
        tags: ["Yellow Tag"],
      }),
    ];
    const chips = deriveTagChips(annots, {
      ...NO_FILTER,
      colors: ["#FFD400"],
      tags: ["Yellow Tag"],
    });
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({
      name: "Yellow Tag",
      selected: true,
      hitCount: 0,
      available: false,
    });
  });
});

describe("cappedSelection", () => {
  it("reports an empty selection as nothing shown and nothing hidden", () => {
    expect(cappedSelection([], 3)).toEqual({ shown: [], hiddenCount: 0 });
  });

  it("shows every value while the selection is within the cap", () => {
    expect(cappedSelection(["a"], 3)).toEqual({ shown: ["a"], hiddenCount: 0 });
    expect(cappedSelection(["a", "b", "c"], 3)).toEqual({
      shown: ["a", "b", "c"],
      hiddenCount: 0,
    });
  });

  it("counts what the cap leaves out, in the order it was given", () => {
    expect(cappedSelection(["a", "b", "c", "d"], 3)).toEqual({
      shown: ["a", "b", "c"],
      hiddenCount: 1,
    });
    expect(
      cappedSelection(["a", "b", "c", "d", "e", "f", "g", "h"], 3),
    ).toEqual({ shown: ["a", "b", "c"], hiddenCount: 5 });
  });

  it("caps the tag trigger at its one name", () => {
    expect(cappedSelection(["Apple", "Mango"], 1)).toEqual({
      shown: ["Apple"],
      hiddenCount: 1,
    });
  });
});
