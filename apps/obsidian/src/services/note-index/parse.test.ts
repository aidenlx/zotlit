import { describe, expect, it } from "vitest";

import { FIELD_ZOTERO_KEY, FIELD_ZOTERO_NOTE_KEY } from "@/lib/constants";

import { diffContributions, fileContributions } from "./parse";

const ITEM_A = "ABCD2345";
const ITEM_A_GROUP = `${ITEM_A}g42`;
const ITEM_B = "ZZZZ9999";

describe("note-index parse", () => {
  it("extracts valid frontmatter item keys", () => {
    expect(
      fileContributions({
        frontmatter: { [FIELD_ZOTERO_KEY]: ITEM_A },
      }).itemKey,
    ).toBe(ITEM_A);
    expect(
      fileContributions({
        frontmatter: { [FIELD_ZOTERO_KEY]: ITEM_A_GROUP },
      }),
    ).toMatchObject({
      itemKey: ITEM_A_GROUP,
    });
  });

  it("skips missing or invalid frontmatter values", () => {
    expect(fileContributions({}).itemKey).toBeNull();
    expect(
      fileContributions({
        frontmatter: { [FIELD_ZOTERO_KEY]: "INVALID" },
      }),
    ).toMatchObject({
      itemKey: null,
    });
  });

  it("reports an empty diff for identical values", () => {
    const prev = fileContributions({
      frontmatter: { [FIELD_ZOTERO_KEY]: ITEM_A },
    });
    const next = fileContributions({
      frontmatter: { [FIELD_ZOTERO_KEY]: ITEM_A },
    });

    expect(diffContributions(prev, next)).toMatchObject({ empty: true });
  });

  it("reports itemKey add/remove changes", () => {
    const prev = fileContributions({
      frontmatter: { [FIELD_ZOTERO_KEY]: ITEM_A },
    });
    const next = fileContributions({
      frontmatter: { [FIELD_ZOTERO_KEY]: ITEM_B },
    });

    expect(diffContributions(prev, next)).toMatchObject({
      empty: false,
      itemKey: { remove: ITEM_A, add: ITEM_B },
    });
  });

  it("extracts an imported note key disjoint from the item key", () => {
    expect(
      fileContributions({
        frontmatter: { [FIELD_ZOTERO_NOTE_KEY]: ITEM_A },
      }),
    ).toMatchObject({
      itemKey: null,
      noteKey: ITEM_A,
    });
    expect(
      fileContributions({
        frontmatter: { [FIELD_ZOTERO_NOTE_KEY]: "INVALID" },
      }).noteKey,
    ).toBeNull();
  });

  it("reports noteKey add/remove changes", () => {
    const prev = fileContributions({
      frontmatter: { [FIELD_ZOTERO_NOTE_KEY]: ITEM_A },
    });
    const next = fileContributions({
      frontmatter: { [FIELD_ZOTERO_NOTE_KEY]: ITEM_B },
    });

    expect(diffContributions(prev, next)).toMatchObject({
      empty: false,
      noteKey: { remove: ITEM_A, add: ITEM_B },
    });
  });
});
