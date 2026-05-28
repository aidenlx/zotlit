import { type AnnotationPositionRaw } from "@drizzle/schema";
import { describe, expect, it } from "vitest";

import { annotationTypeFromID } from "./zt-annot";
import {
  parseAnnotationPosition,
  type AnnotationPosition,
} from "./zt-annot-pos";

describe("parseAnnotationPosition", () => {
  it("parses PDF rect positions", () => {
    expect(
      parseAnnotationPosition(
        { pageIndex: 2, rects: [[1, 2, 3, 4]] },
        "application/pdf",
      ),
    ).toEqual<AnnotationPosition>({
      kind: "pdf-rects",
      pageIndex: 2,
      rects: [[1, 2, 3, 4]],
    });
  });

  it("parses PDF ink positions", () => {
    expect(
      parseAnnotationPosition(
        { pageIndex: 3, width: 2, paths: [[1, 2, 3, 4]] },
        "application/pdf",
      ),
    ).toEqual<AnnotationPosition>({
      kind: "pdf-ink",
      pageIndex: 3,
      width: 2,
      paths: [[1, 2, 3, 4]],
    });
  });

  it("parses PDF text positions", () => {
    expect(
      parseAnnotationPosition(
        {
          pageIndex: 4,
          rects: [[10, 20, 30, 40]],
          fontSize: 14,
          rotation: 90,
        },
        "application/pdf",
      ),
    ).toEqual<AnnotationPosition>({
      kind: "pdf-text",
      pageIndex: 4,
      rects: [[10, 20, 30, 40]],
      fontSize: 14,
      rotation: 90,
    });
  });

  it("parses EPUB CFI selectors", () => {
    expect(
      parseAnnotationPosition(
        {
          type: "FragmentSelector",
          conformsTo: "http://www.idpf.org/epub/linking/cfi/epub-cfi.html",
          value: "epubcfi(/6/2!/4/2/10)",
        },
        "application/epub+zip",
      ),
    ).toEqual<AnnotationPosition>({
      kind: "epub-cfi",
      value: "epubcfi(/6/2!/4/2/10)",
    });
  });

  it("parses snapshot CSS selectors without refinement", () => {
    expect(
      parseAnnotationPosition(
        { type: "CssSelector", value: "body > article:nth-child(1)" },
        "text/html",
      ),
    ).toEqual<AnnotationPosition>({
      kind: "snapshot-css",
      value: "body > article:nth-child(1)",
    });
  });

  it("parses snapshot CSS selectors with text-position refinement", () => {
    expect(
      parseAnnotationPosition(
        {
          type: "CssSelector",
          value: "#target",
          refinedBy: { type: "TextPositionSelector", start: 7, end: 19 },
        },
        "application/xhtml+xml",
      ),
    ).toEqual<AnnotationPosition>({
      kind: "snapshot-css",
      value: "#target",
      refinedBy: { start: 7, end: 19 },
    });
  });

  it("parses snapshot text-position selectors", () => {
    expect(
      parseAnnotationPosition(
        { type: "TextPositionSelector", start: 12, end: 34 },
        "text/html",
      ),
    ).toEqual<AnnotationPosition>({
      kind: "snapshot-text",
      start: 12,
      end: 34,
    });
  });

  it("returns unknown for malformed shapes", () => {
    const raw = {
      pageIndex: 1,
      rects: [[1, 2, 3]],
    } as unknown as AnnotationPositionRaw;

    expect(parseAnnotationPosition(raw, "application/pdf")).toEqual({
      kind: "unknown",
      raw,
    });
  });
});

describe("annotationTypeFromID", () => {
  it("maps known numeric types", () => {
    expect(annotationTypeFromID(1, "KNOWN")).toBe("highlight");
    expect(annotationTypeFromID(6, "KNOWN")).toBe("text");
  });

  it("keeps rows with unknown numeric types as unknown", () => {
    expect(annotationTypeFromID(99, "FUTURE")).toBe("unknown");
  });
});
