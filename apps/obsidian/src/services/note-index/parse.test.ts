import { type Pos, type SectionCache } from "obsidian";
import { describe, expect, it } from "vitest";

import { diffContributions, fileContributions } from "./parse";

const ITEM_A = "ABCD2345";
const ITEM_A_GROUP = `${ITEM_A}g42`;
const ITEM_B = "ZZZZ9999";
const PARENT = "PQRST678";

describe("note-index parse", () => {
  it("extracts valid frontmatter item keys and citekeys", () => {
    expect(
      fileContributions({
        frontmatter: {
          "zotero-key": ITEM_A,
          citekey: "doe2024",
        },
      }).itemKey,
    ).toBe(ITEM_A);
    expect(
      fileContributions({
        frontmatter: {
          "zotero-key": ITEM_A_GROUP,
          citekey: "doe2024",
        },
      }),
    ).toMatchObject({
      itemKey: ITEM_A_GROUP,
      citekey: "doe2024",
    });
  });

  it("skips missing or invalid frontmatter values", () => {
    expect(fileContributions({}).itemKey).toBeNull();
    expect(
      fileContributions({
        frontmatter: {
          "zotero-key": "INVALID",
          citekey: "",
        },
      }),
    ).toMatchObject({
      itemKey: null,
      citekey: null,
    });
  });

  it("extracts annotation block keys from single and multi-key sections", () => {
    const sharedPosition = pos(2);
    const contributions = fileContributions({
      sections: [
        section(`${ITEM_A}a${PARENT}g42p7`, 1),
        {
          id: `${ITEM_A}a${PARENT}g42n${ITEM_B}a${PARENT}p2`,
          position: sharedPosition,
          type: "paragraph",
        },
        section("not-a-zotlit-block", 3),
      ],
    });

    expect(contributions.blocks.get(ITEM_A_GROUP)).toEqual([
      pos(1),
      sharedPosition,
    ]);
    expect(contributions.blocks.get(ITEM_B)).toEqual([sharedPosition]);
  });

  it("reports an empty diff for identical values", () => {
    const prev = fileContributions({
      frontmatter: { "zotero-key": ITEM_A, citekey: "doe2024" },
      sections: [section(`${ITEM_A}a${PARENT}p7`, 1)],
    });
    const next = fileContributions({
      frontmatter: { "zotero-key": ITEM_A, citekey: "doe2024" },
      sections: [section(`${ITEM_A}a${PARENT}p7`, 1)],
    });

    expect(diffContributions(prev, next)).toMatchObject({ empty: true });
  });

  it("reports itemKey and citekey add/remove changes", () => {
    const prev = fileContributions({
      frontmatter: { "zotero-key": ITEM_A, citekey: "doe2024" },
    });
    const next = fileContributions({
      frontmatter: { "zotero-key": ITEM_B, citekey: "roe2025" },
    });

    expect(diffContributions(prev, next)).toMatchObject({
      empty: false,
      itemKey: { remove: ITEM_A, add: ITEM_B },
      citekey: { remove: "doe2024", add: "roe2025" },
    });
  });

  it("reports block removals and additions when positions change", () => {
    const prev = fileContributions({
      sections: [section(`${ITEM_A}a${PARENT}p7`, 1)],
    });
    const next = fileContributions({
      sections: [section(`${ITEM_A}a${PARENT}p7`, 4)],
    });

    expect(diffContributions(prev, next)).toMatchObject({
      empty: false,
      blocks: { remove: [ITEM_A], add: [ITEM_A] },
    });
  });
});

function section(id: string, line: number): SectionCache {
  return { id, position: pos(line), type: "paragraph" };
}

function pos(line: number): Pos {
  return {
    start: { line, col: 0, offset: line * 10 },
    end: { line, col: 5, offset: line * 10 + 5 },
  };
}
