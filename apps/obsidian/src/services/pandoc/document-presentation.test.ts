import type { CachedMetadata, MetadataCache, TFile } from "obsidian";
import { describe, expect, it } from "vitest";

import {
  documentPresentation,
  samePresentation,
} from "./document-presentation";

const FILE = { path: "draft.md" } as TFile;

const STYLE_ID = "http://www.zotero.org/styles/nature";

describe("documentPresentation", () => {
  it("inherits the vault selection where the note carries no properties", () => {
    expect(documentPresentation(cacheOf(null), FILE)).toEqual({});
  });

  it("inherits the vault selection where the note names no style", () => {
    expect(documentPresentation(cacheOf({ title: "Draft" }), FILE)).toEqual({});
  });

  it("takes the CSL ID the note names", () => {
    expect(
      documentPresentation(cacheOf({ "zotlit-csl": STYLE_ID }), FILE),
    ).toEqual({ styleId: STYLE_ID });
  });

  it("reads the CSL ID as the property writes it, spacing aside", () => {
    expect(
      documentPresentation(cacheOf({ "zotlit-csl": `  ${STYLE_ID}\t` }), FILE),
    ).toEqual({ styleId: STYLE_ID });
  });

  it.each([
    ["emptied", ""],
    ["blank", "   "],
    ["cleared", null],
    ["a list", [STYLE_ID]],
    ["a number", 12],
    ["a map", { id: STYLE_ID }],
  ])("fails the note where the property is %s", (_name, value) => {
    expect(documentPresentation(cacheOf({ "zotlit-csl": value }), FILE)).toBe(
      null,
    );
  });
});

describe("samePresentation", () => {
  it("holds a failed note apart from an inheriting one", () => {
    expect(samePresentation(null, {})).toBe(false);
    expect(samePresentation(null, null)).toBe(true);
  });

  it("follows the style and the locale a presentation names", () => {
    expect(samePresentation({ styleId: STYLE_ID }, { styleId: STYLE_ID })).toBe(
      true,
    );
    expect(samePresentation({ styleId: STYLE_ID }, {})).toBe(false);
    expect(samePresentation({ locale: "de-DE" }, { locale: "en-US" })).toBe(
      false,
    );
  });
});

function cacheOf(
  frontmatter: Record<string, unknown> | null,
): Pick<MetadataCache, "getFileCache"> {
  return {
    getFileCache: () =>
      frontmatter === null ? null : ({ frontmatter } as CachedMetadata),
  };
}
