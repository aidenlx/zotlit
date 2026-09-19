import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { USER_LIBRARY_ID } from "@/lib/constants";
import type { Annotation, ResolvedAnnotationTypeName } from "@/lib/zt-annot";
import type { AnnotationFileLinkAnchor } from "@/lib/zt-annot-anchor";

import {
  annotationToTemplateData,
  withAnnotationCitation,
} from "./zt-template-annot";
import type {
  AnnotationTemplateDataInput,
  TemplateAnnotation,
} from "./zt-template-annot";
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
    tags: [],
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

function makeTemplateData(
  overrides?: Partial<Annotation>,
  fileLink: AnnotationTemplateDataInput["fileLink"] = () => () => null,
): TemplateAnnotation {
  return annotationToTemplateData({
    annotation: makeAnnotation(overrides),
    tags: [],
    getParentAttachment: () => parentAttachment,
    getParentItem: () => null,
    commentToMarkdown: (html) => `md(${html})`,
    annotationImageLink: () => null,
    fileLink,
  });
}

/** The anchors the app-layer resolver was asked to build a link for. */
function anchorsFor(
  overrides?: Partial<Annotation>,
): (AnnotationFileLinkAnchor | undefined)[] {
  const anchors: (AnnotationFileLinkAnchor | undefined)[] = [];
  makeTemplateData(overrides, (anchor) => {
    anchors.push(anchor);
    return () => null;
  });
  return anchors;
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

describe("fileLink", () => {
  // The page is what Obsidian jumps to; the Indexed Key is what ZotLit lands a
  // Mark on. Both ride in the one subpath the app layer builds from this.
  it("anchors to the annotation's page and to the annotation itself", () => {
    expect(anchorsFor()).toEqual([{ page: 42, annotation: "ANNO0001" }]);
  });

  it("names a group library's annotation by its scoped Indexed Key", () => {
    expect(anchorsFor({ groupID: 12, indexedKey: "ANNO0001g12" })).toEqual([
      { page: 42, annotation: "ANNO0001g12" },
    ]);
  });

  // An EPUB or snapshot Annotation has no page, and no reader places a Mark in
  // one, so the Anchor beside the page goes with it.
  it("anchors nothing for a position that carries no page", () => {
    expect(anchorsFor({ position: {} })).toEqual([undefined]);
  });

  // A profile that tuned its own link keeps it: the template's arguments reach
  // the helper untouched, so the default anchor is a default and nothing more.
  it("hands a template's own alias and subpath straight to the helper", () => {
    const data = makeTemplateData(
      undefined,
      () => (alias, subpath) => `${alias ?? ""}|${subpath ?? ""}`,
    );

    expect(data.fileLink("Open the PDF", "#page=3")).toBe(
      "Open the PDF|#page=3",
    );
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
