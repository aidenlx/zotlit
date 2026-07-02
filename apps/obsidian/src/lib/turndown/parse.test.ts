// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseAnnotation, parseCitation, parseNoteSchema } from "./parse";

/** Build an element carrying `attr` set to the URL-encoded JSON of `payload`. */
function mark(tag: string, attr: string, payload: unknown): Element {
  const el = document.createElement(tag);
  el.setAttribute(attr, encodeURIComponent(JSON.stringify(payload)));
  return el;
}

/** Parse `html` into a detached root the schema gate can be run against. */
function load(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

const LOCAL_USER = "http://zotero.org/users/local/BOtEiq6p/items";

describe("parseCitation", () => {
  it("reads the data-citation payload off the element", () => {
    const el = mark("span", "data-citation", {
      citationItems: [{ uris: [`${LOCAL_USER}/KX67D9YM`], locator: "62" }],
      properties: {},
    });
    expect(parseCitation(el)?.citationItems[0]?.ref?.key).toBe("KX67D9YM");
  });

  it("returns null when the element has no data-citation", () => {
    expect(parseCitation(document.createElement("span"))).toBeNull();
  });
});

describe("parseAnnotation", () => {
  it("reads the data-annotation payload off the element", () => {
    const el = mark("span", "data-annotation", {
      attachmentURI: `${LOCAL_USER}/T2P8T29G`,
      annotationKey: "C2DF35H3",
      color: "#e56eee",
    });
    const info = parseAnnotation(el);
    expect(info?.annotationKey).toBe("C2DF35H3");
    expect(info?.attachment?.key).toBe("T2P8T29G");
    expect(info?.imageAttachmentKey).toBeUndefined();
  });

  it("captures the embedded-image key on an image excerpt", () => {
    const img = mark("img", "data-annotation", {
      attachmentURI: `${LOCAL_USER}/T2P8T29G`,
      annotationKey: "DBKE89L9",
    });
    img.setAttribute("data-attachment-key", "DUPB2GWX");
    expect(parseAnnotation(img)?.imageAttachmentKey).toBe("DUPB2GWX");
  });

  it("returns null when the element has no data-annotation", () => {
    expect(parseAnnotation(document.createElement("span"))).toBeNull();
  });
});

describe("parseNoteSchema", () => {
  it("finds the schema container through the zotero-note znv1 wrapper", () => {
    const root = load(
      '<div class="zotero-note znv1"><div data-schema-version="9"><p>x</p></div></div>',
    );
    const schema = parseNoteSchema(root);
    expect(schema.supported).toBe(true);
    expect(schema).toMatchObject({ version: 9 });
    if (schema.supported) {
      expect(schema.container.innerHTML).toBe("<p>x</p>");
    }
  });

  it("accepts the unwrapped container returned by the API", () => {
    const root = load('<div data-schema-version="10"><p>x</p></div>');
    expect(parseNoteSchema(root)).toMatchObject({
      supported: true,
      version: 10,
    });
  });

  it("rejects a pre-v6 note but reports its version", () => {
    const root = load('<div data-schema-version="5"><p>x</p></div>');
    expect(parseNoteSchema(root)).toEqual({ supported: false, version: 5 });
  });

  it("rejects a note with no schema container", () => {
    expect(parseNoteSchema(load("<p>plain note</p>"))).toEqual({
      supported: false,
      version: null,
    });
  });
});

describe("zt-excerpt-note.html fixture", () => {
  const html = readFileSync(
    join(import.meta.dirname, "__fixtures__/zt-excerpt-note.html"),
    "utf8",
  );

  it("gates the real schema-version=10 note as supported", () => {
    expect(parseNoteSchema(load(html))).toMatchObject({
      supported: true,
      version: 10,
    });
  });

  it("parses every annotation mark (highlight, underline, image) to its keys", () => {
    const annots = [...load(html).querySelectorAll("[data-annotation]")].map(
      parseAnnotation,
    );
    expect(annots.map((a) => a?.annotationKey)).toEqual([
      "JDJKX3N6",
      "V78IHLM9",
      "KMV38EI6",
      "DBKE89L9",
      "AFUVIG9Z",
      "XRZMBHKK",
      "NPUZ9NKS",
    ]);
    expect(annots.every((a) => a?.attachment?.key === "T2P8T29G")).toBe(true);
    expect(annots.every((a) => a?.citationItem?.ref?.key === "KX67D9YM")).toBe(
      true,
    );
    // Only the image excerpt carries an embedded-image key.
    expect(annots.map((a) => a?.imageAttachmentKey)).toEqual([
      undefined,
      undefined,
      undefined,
      "7TTPMKWK",
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("parses every citation span to its cited item key + locator", () => {
    const cites = [...load(html).querySelectorAll("span.citation")].map(
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
