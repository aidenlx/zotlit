import { describe, expect, it } from "vitest";

import {
  annotationColorToName,
  highlightColorToName,
  textColorToName,
} from "./zt-color";

describe("annotationColorToName", () => {
  it("names the modern reader palette", () => {
    expect(annotationColorToName("#ffd400")).toBe("yellow");
    expect(annotationColorToName("#ff6666")).toBe("red");
    expect(annotationColorToName("#5fb236")).toBe("green");
    expect(annotationColorToName("#2ea8e5")).toBe("blue");
    expect(annotationColorToName("#a28ae5")).toBe("purple");
    expect(annotationColorToName("#e56eee")).toBe("magenta");
    expect(annotationColorToName("#f19837")).toBe("orange");
    expect(annotationColorToName("#aaaaaa")).toBe("gray");
  });

  it("names the Citavi-only outliers", () => {
    expect(annotationColorToName("#ff8c19")).toBe("orange");
    expect(annotationColorToName("#a6507b")).toBe("plum");
  });

  it("is case-insensitive on the stored hex", () => {
    expect(annotationColorToName("#FFD400")).toBe("yellow");
  });

  it("returns null for unmapped colors and empty input", () => {
    expect(annotationColorToName("#123456")).toBeNull();
    expect(annotationColorToName("")).toBeNull();
    expect(annotationColorToName(null)).toBeNull();
    expect(annotationColorToName(undefined)).toBeNull();
  });
});

describe("highlightColorToName", () => {
  it("names highlights stored at 50% opacity", () => {
    expect(highlightColorToName("#ffd40080")).toBe("yellow");
    expect(highlightColorToName("#ff666680")).toBe("red");
    expect(highlightColorToName("#5fb23680")).toBe("green");
    expect(highlightColorToName("#2ea8e580")).toBe("blue");
    expect(highlightColorToName("#a28ae580")).toBe("purple");
    expect(highlightColorToName("#f1983780")).toBe("orange");
    expect(highlightColorToName("#e56eee80")).toBe("magenta");
    expect(highlightColorToName("#aaaaaa80")).toBe("gray");
  });

  it("names legacy opaque highlights", () => {
    expect(highlightColorToName("#ffd400")).toBe("yellow");
  });

  it("names highlights serialized as rgba() by Firefox", () => {
    // The actual on-disk form for notes: Firefox normalizes the editor's
    // #rrggbbaa into rgba(r, g, b, 0.5) when innerHTML is read back.
    expect(highlightColorToName("rgba(255, 212, 0, 0.5)")).toBe("yellow");
    expect(highlightColorToName("rgba(255, 102, 102, 0.5)")).toBe("red");
    expect(highlightColorToName("rgba(170, 170, 170, 0.5)")).toBe("gray");
  });

  it("accepts space-separated rgb() / rgba() syntax", () => {
    expect(highlightColorToName("rgba(255 212 0 / 0.5)")).toBe("yellow");
    expect(highlightColorToName("rgb(255 212 0)")).toBe("yellow");
  });

  it("is case-insensitive on the stored hex", () => {
    expect(highlightColorToName("#FFD40080")).toBe("yellow");
  });

  it("returns null for text-palette and unmapped colors", () => {
    // text-color hexes are a different palette and must not match here
    expect(highlightColorToName("#ffcb0080")).toBeNull();
    expect(highlightColorToName("#12345680")).toBeNull();
    expect(highlightColorToName("rgba(255, 203, 0, 0.5)")).toBeNull();
    expect(highlightColorToName("")).toBeNull();
    expect(highlightColorToName(null)).toBeNull();
    expect(highlightColorToName(undefined)).toBeNull();
  });
});

describe("textColorToName", () => {
  it("names the Zotero 7 text-color palette", () => {
    expect(textColorToName("#ff2020")).toBe("red");
    expect(textColorToName("#ff7700")).toBe("orange");
    expect(textColorToName("#ffcb00")).toBe("yellow");
    expect(textColorToName("#4eb31c")).toBe("green");
    expect(textColorToName("#7953e3")).toBe("purple");
    expect(textColorToName("#eb52f7")).toBe("magenta");
    expect(textColorToName("#05a2ef")).toBe("blue");
    expect(textColorToName("#7e8386")).toBe("gray");
  });

  it("names text colors serialized as rgb() by Firefox", () => {
    // The actual on-disk form for notes: Firefox normalizes the editor's
    // #rrggbb into rgb(r, g, b) when innerHTML is read back.
    expect(textColorToName("rgb(255, 32, 32)")).toBe("red");
    expect(textColorToName("rgb(255, 119, 0)")).toBe("orange");
    expect(textColorToName("rgb(126, 131, 134)")).toBe("gray");
  });

  it("accepts space-separated rgb() syntax", () => {
    expect(textColorToName("rgb(255 32 32)")).toBe("red");
  });

  it("is case-insensitive on the stored hex", () => {
    expect(textColorToName("#FF2020")).toBe("red");
  });

  it("returns null for highlight-palette and unmapped colors", () => {
    // highlight hexes are a different palette and must not match here
    expect(textColorToName("#ffd400")).toBeNull();
    expect(textColorToName("#123456")).toBeNull();
    expect(textColorToName("rgb(255, 212, 0)")).toBeNull();
    expect(textColorToName("")).toBeNull();
    expect(textColorToName(null)).toBeNull();
    expect(textColorToName(undefined)).toBeNull();
  });
});
