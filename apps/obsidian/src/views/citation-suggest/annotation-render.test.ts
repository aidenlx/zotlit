// @vitest-environment happy-dom
// An Annotation Suggester row draws Zotero's stored rich text as the
// Annotation View does, never as literal markup.
import { describe, expect, it } from "vitest";

import { pageLocator } from "@/views/annot-view/excerpt-parts";

import type { AnnotationHit } from "./annotation-search";
import { renderAnnotationHit } from "./annotation-suggest";

const hit: AnnotationHit = {
  key: "ANN2HGHT",
  attachmentKey: "PDF2LIVE",
  itemKey: "ART2FULL",
  type: "highlight",
  text: "E = mc<sup>2</sup>",
  comment: "<b>Key</b> result",
  color: "#ffd400",
  pageLabel: "4",
  title: "Exact Matching in Literature Review",
  citationKey: null,
};

describe("renderAnnotationHit", () => {
  it("draws the quote and the comment as rich text", () => {
    const el = document.createElement("div");
    renderAnnotationHit(hit, el);
    expect(el.querySelector("sup")?.textContent).toBe("2");
    expect(el.querySelector("b")?.textContent).toBe("Key");
    expect(el.textContent).not.toContain("<");
  });

  it("names the page as the Annotation View does, then the paper", () => {
    const el = document.createElement("div");
    renderAnnotationHit(hit, el);
    expect(el.textContent).toContain(
      `${pageLocator("4")} · Exact Matching in Literature Review`,
    );
  });
});
