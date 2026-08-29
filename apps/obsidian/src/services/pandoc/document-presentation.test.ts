import type { CachedMetadata, MetadataCache, TFile } from "obsidian";
import { describe, expect, it } from "vitest";

import type { Settings } from "@/services/settings/schema";
import { defaults } from "@/services/settings/schema";

import {
  documentCitationPresentation,
  documentPresentation,
  samePresentation,
} from "./document-presentation";

const FILE = { path: "draft.md" } as TFile;

const STYLE_ID = "http://www.zotero.org/styles/nature";

/** The presentation a note renders under, which is what most assertions read. */
function read(frontmatter: Record<string, unknown> | null) {
  return documentPresentation(cacheOf(frontmatter), FILE);
}

function profileSettings(
  defaultStyle: string | null,
  profileStyle?: string | null,
): Readonly<Settings> {
  return {
    ...defaults,
    "note.default-profile": {
      ...defaults["note.default-profile"],
      bindings: {
        ...defaults["note.default-profile"].bindings,
        "citation.references-style": defaultStyle,
      },
    },
    "note.profiles": [
      {
        id: "Bk3Qn7XvT2Lp",
        label: "Research",
        ...(profileStyle === undefined
          ? {}
          : {
              bindings: { "citation.references-style": profileStyle },
            }),
      },
    ],
  };
}

describe("documentPresentation", () => {
  it("inherits the vault selections where the note carries no properties", () => {
    expect(read(null)).toEqual({ kind: "read", presentation: {} });
  });

  it("inherits the vault selections where the note names neither", () => {
    expect(read({ title: "Draft" })).toEqual({
      kind: "read",
      presentation: {},
    });
  });

  it("takes the CSL ID the note names", () => {
    expect(read({ "zotlit-csl": STYLE_ID })).toEqual({
      kind: "read",
      presentation: { styleId: STYLE_ID },
    });
  });

  it("reads the CSL ID as the property writes it, spacing aside", () => {
    expect(read({ "zotlit-csl": `  ${STYLE_ID}\t` })).toEqual({
      kind: "read",
      presentation: { styleId: STYLE_ID },
    });
  });

  it("takes the Document Language as the note's Citation Locale", () => {
    expect(read({ lang: "de-DE" })).toEqual({
      kind: "read",
      presentation: { locale: "de-DE" },
    });
  });

  it("reads the Document Language as the property writes it, spacing aside", () => {
    expect(read({ lang: " zh-Hans-CN " })).toEqual({
      kind: "read",
      presentation: { locale: "zh-Hans-CN" },
    });
  });

  it("takes a style and a language the note names together", () => {
    expect(read({ "zotlit-csl": STYLE_ID, lang: "de-DE" })).toEqual({
      kind: "read",
      presentation: { styleId: STYLE_ID, locale: "de-DE" },
    });
  });

  it("takes an Imported Note style from its stamped Profile", () => {
    const settings = profileSettings("default-style", "research-style");

    expect(
      documentPresentation(
        cacheOf({
          "zotero-note-key": "1/NOTE1234",
          "zotlit-profile": "Bk3Qn7XvT2Lp",
        }),
        FILE,
        settings,
      ),
    ).toEqual({
      kind: "read",
      presentation: { styleId: "research-style" },
      profileStyle: {
        profileId: "Bk3Qn7XvT2Lp",
        target: FILE.path,
      },
    });
  });

  it("inherits an omitted Imported Note Profile style from the default Profile", () => {
    const settings = profileSettings("default-style");

    expect(
      documentPresentation(
        cacheOf({
          "zotero-note-key": "1/NOTE1234",
          "zotlit-profile": "Bk3Qn7XvT2Lp",
        }),
        FILE,
        settings,
      ),
    ).toEqual({
      kind: "read",
      presentation: { styleId: "default-style" },
      profileStyle: {
        profileId: "Bk3Qn7XvT2Lp",
        target: FILE.path,
      },
    });
  });

  it("takes a stampless Imported Note style from the default Profile", () => {
    const settings = profileSettings("default-style");

    expect(
      documentPresentation(
        cacheOf({ "zotero-note-key": "1/NOTE1234" }),
        FILE,
        settings,
      ),
    ).toEqual({
      kind: "read",
      presentation: { styleId: "default-style" },
      profileStyle: { profileId: null, target: FILE.path },
    });
  });

  it("keeps a Literature Note on document and vault presentation", () => {
    const settings = profileSettings("default-style", "research-style");

    expect(
      documentPresentation(
        cacheOf({
          "zotero-key": "1/ITEM1234",
          "zotlit-profile": "Bk3Qn7XvT2Lp",
        }),
        FILE,
        settings,
      ),
    ).toEqual({ kind: "read", presentation: {} });
  });

  it("keeps an Imported Note's Profile style in charge", () => {
    const settings = profileSettings("default-style", "research-style");

    expect(
      documentPresentation(
        cacheOf({
          "zotero-note-key": "1/NOTE1234",
          "zotlit-profile": "Bk3Qn7XvT2Lp",
          "zotlit-csl": "document-style",
        }),
        FILE,
        settings,
      ),
    ).toEqual({
      kind: "read",
      presentation: { styleId: "research-style" },
      profileStyle: {
        profileId: "Bk3Qn7XvT2Lp",
        target: FILE.path,
      },
    });
  });

  it("resolves an Imported Note's Profile from a full-form stamp", () => {
    const settings = profileSettings("default-style", "research-style");

    expect(
      documentPresentation(
        cacheOf({
          "zotero-note-key": "1/NOTE1234",
          "zotlit-profile": "Research (Bk3Qn7XvT2Lp)",
        }),
        FILE,
        settings,
      ),
    ).toEqual({
      kind: "read",
      presentation: { styleId: "research-style" },
      profileStyle: { profileId: "Bk3Qn7XvT2Lp", target: FILE.path },
    });
  });

  it("reads a Profile stamp Obsidian stored as a one-item list", () => {
    const settings = profileSettings("default-style", "research-style");

    expect(
      documentPresentation(
        cacheOf({
          "zotero-note-key": "1/NOTE1234",
          "zotlit-profile": ["Bk3Qn7XvT2Lp"],
        }),
        FILE,
        settings,
      ),
    ).toEqual({
      kind: "read",
      presentation: { styleId: "research-style" },
      profileStyle: {
        profileId: "Bk3Qn7XvT2Lp",
        target: FILE.path,
      },
    });
  });

  it("refuses an Imported Note whose Profile is unavailable", () => {
    const settings = profileSettings("default-style");

    expect(
      documentPresentation(
        cacheOf({
          "zotero-note-key": "1/NOTE1234",
          "zotlit-profile": "deleted-profile",
        }),
        FILE,
        settings,
      ),
    ).toEqual({
      kind: "unusable",
      property: "profile",
      diagnostic: {
        code: "unknown-literature-note-profile",
        hint: "Re-stamp the note or recreate the Profile with the same ID.",
        stamp: "deleted-profile",
      },
      target: FILE.path,
    });
  });

  it.each([
    ["emptied", ""],
    ["blank", "   "],
    ["cleared", null],
    ["a list", [STYLE_ID]],
    ["a number", 12],
    ["a map", { id: STYLE_ID }],
  ])("fails the note where the style property is %s", (_name, value) => {
    expect(read({ "zotlit-csl": value })).toEqual({
      kind: "unusable",
      property: "style",
    });
  });

  it.each([
    ["emptied", ""],
    ["blank", "   "],
    ["cleared", null],
    ["a list", ["de-DE"]],
    ["a number", 12],
    ["no language tag", "German (Germany)"],
    ["written as a POSIX locale", "de_DE"],
  ])("fails the note where the language property is %s", (_name, value) => {
    expect(read({ lang: value })).toEqual({
      kind: "unusable",
      property: "language",
    });
  });

  it("names the style before the language where both are unusable", () => {
    expect(read({ "zotlit-csl": "", lang: "de_DE" })).toEqual({
      kind: "unusable",
      property: "style",
    });
  });
});

describe("documentCitationPresentation", () => {
  const VAULT = {
    styleId: "http://www.zotero.org/styles/apa",
    locale: "en-US",
  };
  const ALPHA = { id: "zotero://alpha", type: "book" };
  const BETA = { id: "zotero://beta", type: "book" };
  const cited = {
    citations: [
      { indexedKey: "1/ALPHA" },
      { indexedKey: null },
      { indexedKey: "1/BETA" },
      { indexedKey: "1/GONE" },
    ],
    works: new Map([
      ["1/BETA", { csl: BETA }],
      ["1/ALPHA", { csl: ALPHA }],
    ]),
  };

  it("names the style, the locale, and the cited works as one value", () => {
    expect(
      documentCitationPresentation(read({ lang: "de-DE" }), VAULT, cited),
    ).toEqual({
      kind: "read",
      presentation: { styleId: VAULT.styleId, locale: "de-DE" },
      // Document order, and no slot for a Citation naming no readable work.
      items: [ALPHA, BETA],
    });
  });

  it("inherits both vault selections where the note names neither", () => {
    expect(
      documentCitationPresentation(read(null), VAULT, cited),
    ).toMatchObject({ presentation: VAULT });
  });

  it("leaves the vault selections out of a note that renders none", () => {
    expect(
      documentCitationPresentation(read({ "zotlit-csl": "" }), VAULT, cited),
    ).toEqual({ kind: "unusable", property: "style" });
  });
});

describe("samePresentation", () => {
  const unusable = (property: "style" | "language") =>
    ({ kind: "unusable", property }) as const;
  const renders = (presentation: { styleId?: string; locale?: string }) =>
    ({ kind: "read", presentation }) as const;

  it("holds a failed note apart from an inheriting one", () => {
    expect(samePresentation(unusable("style"), renders({}))).toBe(false);
    expect(samePresentation(unusable("style"), unusable("style"))).toBe(true);
  });

  it("holds the two failing properties apart", () => {
    expect(samePresentation(unusable("style"), unusable("language"))).toBe(
      false,
    );
  });

  it("follows the style and the locale a presentation names", () => {
    expect(
      samePresentation(
        renders({ styleId: STYLE_ID }),
        renders({ styleId: STYLE_ID }),
      ),
    ).toBe(true);
    expect(samePresentation(renders({ styleId: STYLE_ID }), renders({}))).toBe(
      false,
    );
    expect(
      samePresentation(
        renders({ locale: "de-DE" }),
        renders({ locale: "en-US" }),
      ),
    ).toBe(false);
  });

  it("holds Profile style provenance apart", () => {
    const presentation = { styleId: STYLE_ID };
    expect(
      samePresentation(
        {
          kind: "read",
          presentation,
          profileStyle: { profileId: "research", target: FILE.path },
        },
        { kind: "read", presentation },
      ),
    ).toBe(false);
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
