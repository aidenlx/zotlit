import { describe, expect, it } from "vitest";

import {
  FIELD_CITEKEY,
  FIELD_ZOTERO_KEY,
  FIELD_ZOTERO_NOTE_KEY,
} from "@/lib/constants";

import { diffContributions, fileContributions } from "./parse";

const ITEM_A = "ABCD2345";
const ITEM_A_GROUP = `${ITEM_A}g42`;
const ITEM_B = "ZZZZ9999";

describe("note-index parse", () => {
  it("extracts valid frontmatter item keys and citekeys", () => {
    expect(
      fileContributions(
        {
          frontmatter: {
            [FIELD_ZOTERO_KEY]: ITEM_A,
            [FIELD_CITEKEY]: "doe2024",
          },
        },
        FIELD_CITEKEY,
      ).itemKey,
    ).toBe(ITEM_A);
    expect(
      fileContributions(
        {
          frontmatter: {
            [FIELD_ZOTERO_KEY]: ITEM_A_GROUP,
            [FIELD_CITEKEY]: "doe2024",
          },
        },
        FIELD_CITEKEY,
      ),
    ).toMatchObject({
      itemKey: ITEM_A_GROUP,
      citationKey: "doe2024",
    });
  });

  it("skips missing or invalid frontmatter values", () => {
    expect(fileContributions({}, FIELD_CITEKEY).itemKey).toBeNull();
    expect(
      fileContributions(
        {
          frontmatter: {
            [FIELD_ZOTERO_KEY]: "INVALID",
            [FIELD_CITEKEY]: "",
          },
        },
        FIELD_CITEKEY,
      ),
    ).toMatchObject({
      itemKey: null,
      citationKey: null,
    });
  });

  it("reports an empty diff for identical values", () => {
    const prev = fileContributions(
      {
        frontmatter: {
          [FIELD_ZOTERO_KEY]: ITEM_A,
          [FIELD_CITEKEY]: "doe2024",
        },
      },
      FIELD_CITEKEY,
    );
    const next = fileContributions(
      {
        frontmatter: {
          [FIELD_ZOTERO_KEY]: ITEM_A,
          [FIELD_CITEKEY]: "doe2024",
        },
      },
      FIELD_CITEKEY,
    );

    expect(diffContributions(prev, next)).toMatchObject({ empty: true });
  });

  it("reports itemKey and citation-key add/remove changes", () => {
    const prev = fileContributions(
      {
        frontmatter: {
          [FIELD_ZOTERO_KEY]: ITEM_A,
          [FIELD_CITEKEY]: "doe2024",
        },
      },
      FIELD_CITEKEY,
    );
    const next = fileContributions(
      {
        frontmatter: {
          [FIELD_ZOTERO_KEY]: ITEM_B,
          [FIELD_CITEKEY]: "roe2025",
        },
      },
      FIELD_CITEKEY,
    );

    expect(diffContributions(prev, next)).toMatchObject({
      empty: false,
      itemKey: { remove: ITEM_A, add: ITEM_B },
      citationKey: { remove: "doe2024", add: "roe2025" },
    });
  });

  it("extracts an imported note key disjoint from the item key", () => {
    expect(
      fileContributions(
        {
          frontmatter: { [FIELD_ZOTERO_NOTE_KEY]: ITEM_A },
        },
        FIELD_CITEKEY,
      ),
    ).toMatchObject({
      itemKey: null,
      citationKey: null,
      noteKey: ITEM_A,
    });
    expect(
      fileContributions(
        {
          frontmatter: { [FIELD_ZOTERO_NOTE_KEY]: "INVALID" },
        },
        FIELD_CITEKEY,
      ).noteKey,
    ).toBeNull();
  });

  it("reports noteKey add/remove changes", () => {
    const prev = fileContributions(
      {
        frontmatter: { [FIELD_ZOTERO_NOTE_KEY]: ITEM_A },
      },
      FIELD_CITEKEY,
    );
    const next = fileContributions(
      {
        frontmatter: { [FIELD_ZOTERO_NOTE_KEY]: ITEM_B },
      },
      FIELD_CITEKEY,
    );

    expect(diffContributions(prev, next)).toMatchObject({
      empty: false,
      noteKey: { remove: ITEM_A, add: ITEM_B },
    });
  });
});
