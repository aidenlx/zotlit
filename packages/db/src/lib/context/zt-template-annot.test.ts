import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { Temporal } from "@zotlit/shared/temporal";

import { USER_LIBRARY_ID } from "@/lib/constants";
import type { Annotation, ResolvedAnnotationTypeName } from "@/lib/zt-annot";

import {
  annotationToTemplateData,
  withAnnotationCitation,
} from "./zt-template-annot";
import type { TemplateAnnotation } from "./zt-template-annot";
import type { TemplateAttachment } from "./zt-template-attach";

function makeAnnotation(overrides?: Partial<Annotation>): Annotation {
  return {
    groupID: null,
    itemID: 1,
    key: "ANNO0001",
    indexedKey: "ANNO0001",
    libraryID: USER_LIBRARY_ID,
    dateAdded: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    dateModified: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    type: 1,
    text: "excerpt",
    comment: null,
    color: "#ffd400",
    pageLabel: "42",
    sortIndex: "00000|000000|00000",
    position: { pageIndex: 41 },
    authorName: null,
    isExternal: false,
    parentItemID: 10,
    parentKey: "ATCH0001",
    ...overrides,
  };
}

const parentAttachment: TemplateAttachment = {
  key: "ATCH0001",
  indexedKey: "ATCH0001",
  filename: "paper.pdf",
  contentType: "application/pdf",
  linkMode: "imported_file",
  backlink: "zotero://open-pdf/library/items/ATCH0001",
  filePath: "/abs/paper.pdf",
  fileLink: () => "[paper.pdf](file:///abs/paper.pdf)",
};

function makeTemplateData(overrides?: Partial<Annotation>): TemplateAnnotation {
  return annotationToTemplateData({
    annotation: makeAnnotation(overrides),
    tags: [],
    getParentAttachment: () => parentAttachment,
    getParentItem: () => null,
    commentToMarkdown: (html) => `md(${html})`,
    annotationImageLink: () => null,
    fileLink: () => () => null,
  });
}

describe("annotation type", () => {
  it("is a closed literal union of the type names a template can receive", () => {
    expectTypeOf<ResolvedAnnotationTypeName>().toEqualTypeOf<
      "highlight" | "note" | "image" | "ink" | "underline" | "text" | "unknown"
    >();
    expectTypeOf<
      TemplateAnnotation["type"]
    >().toEqualTypeOf<ResolvedAnnotationTypeName>();
  });

  it("rejects a type name outside the union at compile time", () => {
    // @ts-expect-error — "scribble" is not an annotation type name.
    const outside: ResolvedAnnotationTypeName = "scribble";
    expect(outside).toBe("scribble");
  });

  it("resolves the raw type int to its literal name", () => {
    expect(makeTemplateData({ type: 1 }).type).toBe("highlight");
    expect(makeTemplateData({ type: 5 }).type).toBe("underline");
  });
});

describe("indexedKey", () => {
  it("passes through the bare indexedKey for the personal library", () => {
    const result = makeTemplateData({
      key: "ANNO0001",
      indexedKey: "ANNO0001",
      groupID: null,
    });

    expect(result.indexedKey).toBe("ANNO0001");
  });

  it("passes through the scoped indexedKey for a group library", () => {
    const result = makeTemplateData({
      key: "ANNO0001",
      indexedKey: "ANNO0001g42",
      groupID: 42,
    });

    expect(result.indexedKey).toBe("ANNO0001g42");
  });
});

describe("withAnnotationCitation", () => {
  it("types citation as part of the annotation root", () => {
    const root = withAnnotationCitation(makeTemplateData(), () => "[@doe2020]");

    expectTypeOf(root.citation).toEqualTypeOf<string | null>();
    expect(root.citation).toBe("[@doe2020]");
  });

  it("renders the citation lazily, only when a template reads it", () => {
    const render = vi.fn(() => "[@doe2020, p. 42]");
    const root = withAnnotationCitation(makeTemplateData(), render);

    expect(render).not.toHaveBeenCalled();
    expect(root.citation).toBe("[@doe2020, p. 42]");
    expect(render).toHaveBeenCalledOnce();
  });

  it("exposes citation as an enumerable own field", () => {
    const root = withAnnotationCitation(makeTemplateData(), () => null);

    expect(Object.keys(root)).toContain("citation");
    expect({ ...root }.citation).toBeNull();
  });
});
