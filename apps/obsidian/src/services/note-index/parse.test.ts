import { describe, expect, it } from "vitest";

import { FIELD_CITEKEY, FIELD_ZOTERO_KEY } from "@/lib/constants";

import { diffContributions, fileContributions } from "./parse";

const ITEM_A = "ABCD2345";
const ITEM_A_GROUP = `${ITEM_A}g42`;
const ITEM_B = "ZZZZ9999";

describe("note-index parse", () => {
  it("extracts valid frontmatter item keys and citekeys", () => {
    expect(
      fileContributions({
        frontmatter: {
          [FIELD_ZOTERO_KEY]: ITEM_A,
          [FIELD_CITEKEY]: "doe2024",
        },
      }).itemKey,
    ).toBe(ITEM_A);
    expect(
      fileContributions({
        frontmatter: {
          [FIELD_ZOTERO_KEY]: ITEM_A_GROUP,
          [FIELD_CITEKEY]: "doe2024",
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
          [FIELD_ZOTERO_KEY]: "INVALID",
          [FIELD_CITEKEY]: "",
        },
      }),
    ).toMatchObject({
      itemKey: null,
      citekey: null,
    });
  });

  it("reports an empty diff for identical values", () => {
    const prev = fileContributions({
      frontmatter: {
        [FIELD_ZOTERO_KEY]: ITEM_A,
        [FIELD_CITEKEY]: "doe2024",
      },
    });
    const next = fileContributions({
      frontmatter: {
        [FIELD_ZOTERO_KEY]: ITEM_A,
        [FIELD_CITEKEY]: "doe2024",
      },
    });

    expect(diffContributions(prev, next)).toMatchObject({ empty: true });
  });

  it("reports itemKey and citekey add/remove changes", () => {
    const prev = fileContributions({
      frontmatter: {
        [FIELD_ZOTERO_KEY]: ITEM_A,
        [FIELD_CITEKEY]: "doe2024",
      },
    });
    const next = fileContributions({
      frontmatter: {
        [FIELD_ZOTERO_KEY]: ITEM_B,
        [FIELD_CITEKEY]: "roe2025",
      },
    });

    expect(diffContributions(prev, next)).toMatchObject({
      empty: false,
      itemKey: { remove: ITEM_A, add: ITEM_B },
      citekey: { remove: "doe2024", add: "roe2025" },
    });
  });
});
