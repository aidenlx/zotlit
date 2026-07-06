import { describe, expect, it } from "vitest";

import {
  parseAnnotationData,
  parseCitationData,
  parseEmbeddedCitationItems,
  parseItemUri,
} from "./zt-note-mark";

/** URL-encode `payload` the way Zotero stores it in a data attribute. */
function encode(payload: unknown): string {
  return encodeURIComponent(JSON.stringify(payload));
}

const LOCAL_USER = "http://zotero.org/users/local/BOtEiq6p/items";

describe("parseItemUri", () => {
  it("resolves a local user-library item URI", () => {
    expect(parseItemUri(`${LOCAL_USER}/KX67D9YM`)).toEqual({
      libraryType: "user",
      groupID: null,
      key: "KX67D9YM",
    });
  });

  it("resolves a synced user-library item URI", () => {
    expect(
      parseItemUri("http://zotero.org/users/12345/items/ABCD1234"),
    ).toEqual({ libraryType: "user", groupID: null, key: "ABCD1234" });
  });

  it("resolves a group-library item URI with its group ID", () => {
    expect(
      parseItemUri("http://zotero.org/groups/67890/items/WXYZ0000"),
    ).toEqual({ libraryType: "group", groupID: 67890, key: "WXYZ0000" });
  });

  it("returns null for non-item URIs and junk", () => {
    expect(
      parseItemUri("http://zotero.org/users/local/BOtEiq6p/collections/CCCC"),
    ).toBeNull();
    expect(parseItemUri("https://example.com/foo")).toBeNull();
    expect(parseItemUri("not a uri")).toBeNull();
  });
});

describe("parseCitationData", () => {
  it("parses a single cited item with a locator", () => {
    const encoded = encode({
      citationItems: [{ uris: [`${LOCAL_USER}/KX67D9YM`], locator: "62" }],
      properties: {},
    });
    expect(parseCitationData(encoded)).toEqual({
      citationItems: [
        {
          uris: [`${LOCAL_USER}/KX67D9YM`],
          ref: { libraryType: "user", groupID: null, key: "KX67D9YM" },
          locator: "62",
        },
      ],
    });
  });

  it("parses multiple cited items without locators", () => {
    const encoded = encode({
      citationItems: [
        { uris: [`${LOCAL_USER}/4FQVQ6ZQ`] },
        { uris: [`${LOCAL_USER}/KX67D9YM`] },
      ],
      properties: {},
    });
    const info = parseCitationData(encoded);
    expect(info?.citationItems.map((c) => c.ref?.key)).toEqual([
      "4FQVQ6ZQ",
      "KX67D9YM",
    ]);
    expect(info?.citationItems.every((c) => c.locator === undefined)).toBe(
      true,
    );
  });

  it("returns null for an absent payload", () => {
    expect(parseCitationData(null)).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parseCitationData("%7Bnot json")).toBeNull();
  });

  it("returns null when the shape fails validation", () => {
    expect(parseCitationData(encode({ properties: {} }))).toBeNull();
  });

  it("parses label, suppress-author, prefix, and suffix on a citation item", () => {
    const encoded = encode({
      citationItems: [
        {
          uris: [`${LOCAL_USER}/KX67D9YM`],
          locator: "3",
          label: "chapter",
          "suppress-author": true,
          prefix: "see ",
          suffix: ", note 4",
        },
      ],
      properties: {},
    });
    expect(parseCitationData(encoded)).toEqual({
      citationItems: [
        {
          uris: [`${LOCAL_USER}/KX67D9YM`],
          ref: { libraryType: "user", groupID: null, key: "KX67D9YM" },
          locator: "3",
          label: "chapter",
          suppressAuthor: true,
          prefix: "see ",
          suffix: ", note 4",
        },
      ],
    });
  });

  it("omits label, suppress-author, prefix, and suffix when absent", () => {
    const encoded = encode({
      citationItems: [{ uris: [`${LOCAL_USER}/KX67D9YM`] }],
      properties: {},
    });
    expect(parseCitationData(encoded)).toEqual({
      citationItems: [
        {
          uris: [`${LOCAL_USER}/KX67D9YM`],
          ref: { libraryType: "user", groupID: null, key: "KX67D9YM" },
        },
      ],
    });
  });

  it("drops unknown per-item keys while accepting the widened props", () => {
    const encoded = encode({
      citationItems: [
        {
          uris: [`${LOCAL_USER}/KX67D9YM`],
          locator: "62",
          unknownField: "ignored",
        },
      ],
      properties: {},
    });
    const info = parseCitationData(encoded);
    expect(info?.citationItems[0]).not.toHaveProperty("unknownField");
  });

  it("returns null when suppress-author has the wrong type", () => {
    const encoded = encode({
      citationItems: [
        { uris: [`${LOCAL_USER}/KX67D9YM`], "suppress-author": "yes" },
      ],
      properties: {},
    });
    expect(parseCitationData(encoded)).toBeNull();
  });
});

describe("parseEmbeddedCitationItems", () => {
  it("maps every URI of an entry to its citation key", () => {
    const encoded = encode([
      {
        uris: [`${LOCAL_USER}/KX67D9YM`, `${LOCAL_USER}/ALT0KEY0`],
        itemData: {
          id: `${LOCAL_USER}/KX67D9YM`,
          "citation-key": "Hensher2011",
        },
      },
      {
        uris: [`${LOCAL_USER}/4FQVQ6ZQ`],
        itemData: { id: `${LOCAL_USER}/4FQVQ6ZQ`, "citation-key": "Kang2013" },
      },
    ]);
    expect(parseEmbeddedCitationItems(encoded)).toEqual(
      new Map([
        [`${LOCAL_USER}/KX67D9YM`, "Hensher2011"],
        [`${LOCAL_USER}/ALT0KEY0`, "Hensher2011"],
        [`${LOCAL_USER}/4FQVQ6ZQ`, "Kang2013"],
      ]),
    );
  });

  it("skips entries whose itemData has no citation-key", () => {
    const encoded = encode([
      { uris: [`${LOCAL_USER}/KX67D9YM`], itemData: { id: "x", type: "book" } },
    ]);
    expect(parseEmbeddedCitationItems(encoded).size).toBe(0);
  });

  it("returns an empty map for an absent or malformed attribute", () => {
    expect(parseEmbeddedCitationItems(null).size).toBe(0);
    expect(parseEmbeddedCitationItems("%7Bnot json").size).toBe(0);
    expect(parseEmbeddedCitationItems(encode({ not: "an array" })).size).toBe(
      0,
    );
  });
});

describe("parseAnnotationData", () => {
  it("parses a highlight annotation with its cited item", () => {
    const encoded = encode({
      attachmentURI: `${LOCAL_USER}/T2P8T29G`,
      annotationKey: "C2DF35H3",
      color: "#e56eee",
      pageLabel: "62",
      position: { pageIndex: 0, rects: [[305.992, 215.426, 434.327, 224.482]] },
      citationItem: { uris: [`${LOCAL_USER}/KX67D9YM`], locator: "62" },
    });
    expect(parseAnnotationData(encoded)).toEqual({
      annotationKey: "C2DF35H3",
      attachmentURI: `${LOCAL_USER}/T2P8T29G`,
      attachment: { libraryType: "user", groupID: null, key: "T2P8T29G" },
      color: "#e56eee",
      pageLabel: "62",
      citationItem: {
        uris: [`${LOCAL_USER}/KX67D9YM`],
        ref: { libraryType: "user", groupID: null, key: "KX67D9YM" },
        locator: "62",
      },
    });
  });

  it("returns null for an absent payload", () => {
    expect(parseAnnotationData(null)).toBeNull();
  });

  it("returns null when required keys are missing", () => {
    expect(parseAnnotationData(encode({ color: "#ffd400" }))).toBeNull();
  });
});
