import { describe, expect, it } from "vitest";

import { type AnnotationType, type AnnotViewItem } from "@zotlit/db";

import {
  type AnnotFilter,
  deriveSwatchColors,
  deriveTagChips,
  filterAnnotations,
  isFilterActive,
  pickFirstTagChip,
  sanitizeSavedFilter,
} from "./filter";

function makeAnnot(overrides: Partial<AnnotViewItem> = {}): AnnotViewItem {
  return {
    itemID: 1,
    key: "AAAAAAAA",
    type: 1 as AnnotationType,
    text: null,
    comment: null,
    color: null,
    pageLabel: null,
    parentKey: "PPPPPPPP",
    tags: [],
    ...overrides,
  };
}

const NO_FILTER: AnnotFilter = { query: "", colors: [], tagIDs: [] };

describe("isFilterActive", () => {
  it("is false when all groups are empty", () => {
    expect(isFilterActive(NO_FILTER)).toBe(false);
  });

  it("is true when any group is non-empty", () => {
    expect(isFilterActive({ ...NO_FILTER, query: "x" })).toBe(true);
    expect(isFilterActive({ ...NO_FILTER, colors: ["#FFD400"] })).toBe(true);
    expect(isFilterActive({ ...NO_FILTER, tagIDs: [1] })).toBe(true);
  });
});

describe("filterAnnotations", () => {
  it("passes everything through when the filter is empty", () => {
    const annots = [makeAnnot({ itemID: 1 }), makeAnnot({ itemID: 2 })];
    expect(filterAnnotations(annots, NO_FILTER)).toEqual(annots);
  });

  it("matches query against text, case-insensitively", () => {
    const a = makeAnnot({ itemID: 1, text: "Hello World" });
    const b = makeAnnot({ itemID: 2, text: "Nothing here" });
    const result = filterAnnotations([a, b], {
      ...NO_FILTER,
      query: "hello",
    });
    expect(result).toEqual([a]);
  });

  it("matches query against HTML-stripped comment", () => {
    const a = makeAnnot({
      itemID: 1,
      comment: "<p>See <b>methodology</b> section</p>",
    });
    const b = makeAnnot({ itemID: 2, comment: "<p>unrelated</p>" });
    const result = filterAnnotations([a, b], {
      ...NO_FILTER,
      query: "methodology",
    });
    expect(result).toEqual([a]);
  });

  it("matches query against a tag name", () => {
    const a = makeAnnot({
      itemID: 1,
      tags: [{ tagID: 1, name: "Methodology" }],
    });
    const b = makeAnnot({ itemID: 2, tags: [{ tagID: 2, name: "Other" }] });
    const result = filterAnnotations([a, b], {
      ...NO_FILTER,
      query: "methodo",
    });
    expect(result).toEqual([a]);
  });

  it("matches query against pageLabel", () => {
    const a = makeAnnot({ itemID: 1, pageLabel: "42" });
    const b = makeAnnot({ itemID: 2, pageLabel: "7" });
    const result = filterAnnotations([a, b], { ...NO_FILTER, query: "42" });
    expect(result).toEqual([a]);
  });

  it("matches a lowercase DB color against a canonical uppercase filter color", () => {
    const a = makeAnnot({ itemID: 1, color: "#ffd400" });
    const result = filterAnnotations([a], {
      ...NO_FILTER,
      colors: ["#FFD400"],
    });
    expect(result).toEqual([a]);
  });

  it("excludes a null-color annotation when a color filter is active", () => {
    const a = makeAnnot({ itemID: 1, color: null });
    const result = filterAnnotations([a], {
      ...NO_FILTER,
      colors: ["#FFD400"],
    });
    expect(result).toEqual([]);
  });

  it("includes a null-color annotation when the color group is empty", () => {
    const a = makeAnnot({ itemID: 1, color: null });
    expect(filterAnnotations([a], NO_FILTER)).toEqual([a]);
  });

  it("ORs within the colors group", () => {
    const yellow = makeAnnot({ itemID: 1, color: "#FFD400" });
    const red = makeAnnot({ itemID: 2, color: "#FF6666" });
    const green = makeAnnot({ itemID: 3, color: "#5FB236" });
    const result = filterAnnotations([yellow, red, green], {
      ...NO_FILTER,
      colors: ["#FFD400", "#FF6666"],
    });
    expect(result).toEqual([yellow, red]);
  });

  it("ORs within the tags group", () => {
    const a = makeAnnot({ itemID: 1, tags: [{ tagID: 1, name: "a" }] });
    const b = makeAnnot({ itemID: 2, tags: [{ tagID: 2, name: "b" }] });
    const c = makeAnnot({ itemID: 3, tags: [{ tagID: 3, name: "c" }] });
    const result = filterAnnotations([a, b, c], {
      ...NO_FILTER,
      tagIDs: [1, 2],
    });
    expect(result).toEqual([a, b]);
  });

  it("passes colored annotations through an empty colors group", () => {
    const yellow = makeAnnot({ itemID: 1, color: "#ffd400" });
    const green = makeAnnot({ itemID: 2, color: "#5FB236" });
    const none = makeAnnot({ itemID: 3, color: null });
    expect(filterAnnotations([yellow, green, none], NO_FILTER)).toEqual([
      yellow,
      green,
      none,
    ]);
  });

  it("passes colored annotations when only the colors group is empty, under an active tag or query filter", () => {
    const yellow = makeAnnot({
      itemID: 1,
      color: "#ffd400",
      text: "the methodology approach",
      tags: [{ tagID: 1, name: "Methodology" }],
    });
    const green = makeAnnot({
      itemID: 2,
      color: "#5FB236",
      text: "the methodology approach",
      tags: [{ tagID: 1, name: "Methodology" }],
    });
    const result = filterAnnotations([yellow, green], {
      ...NO_FILTER,
      query: "methodology",
      tagIDs: [1],
    });
    expect(result).toEqual([yellow, green]);
  });

  it("ANDs across groups: color AND tag AND query", () => {
    const match = makeAnnot({
      itemID: 1,
      color: "#ffd400",
      tags: [{ tagID: 1, name: "Methodology" }],
      text: "the methodology approach",
    });
    const wrongColor = makeAnnot({
      itemID: 2,
      color: "#FF6666",
      tags: [{ tagID: 1, name: "Methodology" }],
      text: "the methodology approach",
    });
    const wrongTag = makeAnnot({
      itemID: 3,
      color: "#ffd400",
      tags: [{ tagID: 2, name: "Other" }],
      text: "the methodology approach",
    });
    const wrongQuery = makeAnnot({
      itemID: 4,
      color: "#ffd400",
      tags: [{ tagID: 1, name: "Other Tag" }],
      text: "unrelated text",
    });
    const filter: AnnotFilter = {
      query: "methodology",
      colors: ["#FFD400"],
      tagIDs: [1],
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
      makeAnnot({ itemID: 1, color: "#A6507B" }),
      makeAnnot({ itemID: 2, color: "#5FB236" }),
      makeAnnot({ itemID: 3, color: "#FFD400" }),
      makeAnnot({ itemID: 4, color: null }),
      makeAnnot({ itemID: 5, color: "#ffd400" }),
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
      itemID: 1,
      color: "#FFD400",
      tags: [{ tagID: 1, name: "Methodology" }],
    }),
    makeAnnot({
      itemID: 2,
      color: "#5FB236",
      tags: [{ tagID: 2, name: "Other" }],
    }),
  ];

  it("roundtrips a valid saved selection, pruning colors/tags no longer present", () => {
    const raw = JSON.stringify({
      colors: ["#FFD400", "#AAAAAA"],
      tags: [1, 99],
    });
    expect(sanitizeSavedFilter(raw, annots)).toEqual({
      colors: ["#FFD400"],
      tagIDs: [1],
    });
  });

  it("canonicalizes a lowercase saved color against uppercase annotation colors", () => {
    const raw = JSON.stringify({ colors: ["#ffd400"], tags: [] });
    expect(sanitizeSavedFilter(raw, annots)).toEqual({
      colors: ["#FFD400"],
      tagIDs: [],
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

  it("returns null when everything is pruned away", () => {
    const raw = JSON.stringify({ colors: ["#AAAAAA"], tags: [99] });
    expect(sanitizeSavedFilter(raw, annots)).toBeNull();
  });
});

describe("deriveTagChips", () => {
  it("dedupes tags and orders alphabetically regardless of selection", () => {
    const annots = [
      makeAnnot({
        itemID: 1,
        tags: [
          { tagID: 1, name: "Zebra" },
          { tagID: 2, name: "Apple" },
        ],
      }),
      makeAnnot({
        itemID: 2,
        tags: [
          { tagID: 2, name: "Apple" },
          { tagID: 3, name: "Mango" },
        ],
      }),
    ];
    const chips = deriveTagChips(annots, { ...NO_FILTER, tagIDs: [3] });
    expect(chips.map((c) => c.tagID)).toEqual([2, 3, 1]);
    expect(chips.map((c) => c.selected)).toEqual([false, true, false]);
  });

  it("marks availability against color+query groups only, ignoring the tag group", () => {
    const annots = [
      makeAnnot({
        itemID: 1,
        color: "#FFD400",
        tags: [{ tagID: 1, name: "Yellow Tag" }],
      }),
      makeAnnot({
        itemID: 2,
        color: "#FF6666",
        tags: [{ tagID: 2, name: "Red Tag" }],
      }),
    ];
    const chips = deriveTagChips(annots, {
      ...NO_FILTER,
      colors: ["#FFD400"],
    });
    const byID = new Map(chips.map((c) => [c.tagID, c]));
    expect(byID.get(1)?.hitCount).toBe(1);
    expect(byID.get(1)?.available).toBe(true);
    expect(byID.get(2)?.hitCount).toBe(0);
    expect(byID.get(2)?.available).toBe(false);
  });

  it("counts colored annotations toward hitCount when the colors group is empty", () => {
    const annots = [
      makeAnnot({
        itemID: 1,
        color: "#FFD400",
        tags: [{ tagID: 1, name: "Yellow Tag" }],
      }),
      makeAnnot({
        itemID: 2,
        color: "#5FB236",
        tags: [{ tagID: 1, name: "Yellow Tag" }],
      }),
    ];
    const chips = deriveTagChips(annots, NO_FILTER);
    expect(chips[0]).toMatchObject({
      tagID: 1,
      hitCount: 2,
      available: true,
    });
  });

  it("keeps a selected tag with zero current hits, marked unavailable", () => {
    const annots = [
      makeAnnot({
        itemID: 1,
        color: "#FF6666",
        tags: [{ tagID: 1, name: "Yellow Tag" }],
      }),
    ];
    const chips = deriveTagChips(annots, {
      ...NO_FILTER,
      colors: ["#FFD400"],
      tagIDs: [1],
    });
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({
      tagID: 1,
      selected: true,
      hitCount: 0,
      available: false,
    });
  });
});

describe("pickFirstTagChip", () => {
  it("returns the first selected tag in alphabetical order while filtering", () => {
    const annots = [
      makeAnnot({
        itemID: 1,
        tags: [
          { tagID: 1, name: "Zebra" },
          { tagID: 2, name: "Apple" },
        ],
      }),
      makeAnnot({
        itemID: 2,
        tags: [{ tagID: 3, name: "Mango" }],
      }),
    ];
    const chips = deriveTagChips(annots, { ...NO_FILTER, tagIDs: [3, 1] });
    expect(pickFirstTagChip(chips)?.tagID).toBe(3);
  });

  it("returns the first alphabetical tag when nothing is selected", () => {
    const annots = [
      makeAnnot({
        itemID: 1,
        tags: [
          { tagID: 1, name: "Zebra" },
          { tagID: 2, name: "Apple" },
        ],
      }),
      makeAnnot({
        itemID: 2,
        tags: [{ tagID: 3, name: "Mango" }],
      }),
    ];
    const chips = deriveTagChips(annots, NO_FILTER);
    expect(pickFirstTagChip(chips)?.tagID).toBe(2);
  });

  it("returns undefined for an empty chip list", () => {
    expect(pickFirstTagChip([])).toBeUndefined();
  });
});
