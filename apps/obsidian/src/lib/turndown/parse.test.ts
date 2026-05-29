// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseAnnotation, parseCitation, parseItemUri } from "./parse";

/** Build a span carrying `attr` set to the URL-encoded JSON of `payload`. */
function span(attr: string, payload: unknown): Element {
  const el = document.createElement("span");
  el.setAttribute(attr, encodeURIComponent(JSON.stringify(payload)));
  return el;
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

describe("parseCitation", () => {
  it("parses a single cited item with a locator", () => {
    const el = span("data-citation", {
      citationItems: [{ uris: [`${LOCAL_USER}/KX67D9YM`], locator: "62" }],
      properties: {},
    });
    expect(parseCitation(el)).toEqual({
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
    const el = span("data-citation", {
      citationItems: [
        { uris: [`${LOCAL_USER}/4FQVQ6ZQ`] },
        { uris: [`${LOCAL_USER}/KX67D9YM`] },
      ],
      properties: {},
    });
    const info = parseCitation(el);
    expect(info?.citationItems.map((c) => c.ref?.key)).toEqual([
      "4FQVQ6ZQ",
      "KX67D9YM",
    ]);
    expect(info?.citationItems.every((c) => c.locator === undefined)).toBe(
      true,
    );
  });

  it("returns null when the element has no data-citation", () => {
    expect(parseCitation(document.createElement("span"))).toBeNull();
  });

  it("returns null on a malformed payload", () => {
    const el = document.createElement("span");
    el.setAttribute("data-citation", "%7Bnot json");
    expect(parseCitation(el)).toBeNull();
  });
});

describe("parseAnnotation", () => {
  it("parses a highlight annotation with its cited item", () => {
    const el = span("data-annotation", {
      attachmentURI: `${LOCAL_USER}/T2P8T29G`,
      annotationKey: "C2DF35H3",
      color: "#e56eee",
      pageLabel: "62",
      position: { pageIndex: 0, rects: [[305.992, 215.426, 434.327, 224.482]] },
      citationItem: { uris: [`${LOCAL_USER}/KX67D9YM`], locator: "62" },
    });
    expect(parseAnnotation(el)).toEqual({
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

  it("parses an image-excerpt annotation, capturing its embed key", () => {
    const img = document.createElement("img");
    img.setAttribute("data-attachment-key", "DUPB2GWX");
    img.setAttribute(
      "data-annotation",
      encodeURIComponent(
        JSON.stringify({
          attachmentURI: `${LOCAL_USER}/T2P8T29G`,
          annotationKey: "DBKE89L9",
          color: "#ffd400",
          pageLabel: "62",
          position: {
            pageIndex: 0,
            rects: [[219.605, 682.31, 450.971, 719.175]],
          },
          citationItem: { uris: [`${LOCAL_USER}/KX67D9YM`], locator: "62" },
        }),
      ),
    );
    expect(parseAnnotation(img)).toEqual({
      annotationKey: "DBKE89L9",
      attachmentURI: `${LOCAL_USER}/T2P8T29G`,
      attachment: { libraryType: "user", groupID: null, key: "T2P8T29G" },
      color: "#ffd400",
      pageLabel: "62",
      imageAttachmentKey: "DUPB2GWX",
      citationItem: {
        uris: [`${LOCAL_USER}/KX67D9YM`],
        ref: { libraryType: "user", groupID: null, key: "KX67D9YM" },
        locator: "62",
      },
    });
  });

  it("returns null when the element has no data-annotation", () => {
    expect(parseAnnotation(document.createElement("span"))).toBeNull();
  });
});

describe("zt-excerpt-note.html fixture", () => {
  const html = readFileSync(
    join(import.meta.dirname, "__fixtures__/zt-excerpt-note.html"),
    "utf8",
  );

  function load(): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    return root;
  }

  it("parses every annotation mark (highlight, underline, image) to its keys", () => {
    const annots = [...load().querySelectorAll("[data-annotation]")].map(
      parseAnnotation,
    );
    expect(annots.map((a) => a?.annotationKey)).toEqual([
      "C2DF35H3",
      "7SUQ86WL",
      "DBKE89L9",
    ]);
    expect(annots.every((a) => a?.attachment?.key === "T2P8T29G")).toBe(true);
    expect(annots.every((a) => a?.citationItem?.ref?.key === "KX67D9YM")).toBe(
      true,
    );
    // Only the image excerpt carries an embedded-image key.
    expect(annots.map((a) => a?.imageAttachmentKey)).toEqual([
      undefined,
      undefined,
      "DUPB2GWX",
    ]);
  });

  it("parses every citation span to its cited item key + locator", () => {
    const cites = [...load().querySelectorAll("span.citation")].map(
      parseCitation,
    );
    expect(cites.length).toBeGreaterThan(0);
    expect(
      cites.every(
        (c) =>
          c?.citationItems[0]?.ref?.key === "KX67D9YM" &&
          c?.citationItems[0]?.locator === "62",
      ),
    ).toBe(true);
  });
});
