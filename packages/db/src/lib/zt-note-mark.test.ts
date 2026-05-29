import { describe, expect, it } from "vitest";

import {
  parseAnnotationData,
  parseCitationData,
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
