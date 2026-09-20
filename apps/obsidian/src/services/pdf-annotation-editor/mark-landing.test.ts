import { describe, expect, it } from "vitest";

import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type { AttachmentResolution } from "@/services/attachment-resolver/service";

import { annotation } from "./__fixtures__";
import { decideMarkLanding } from "./mark-landing";
import type { PdfPageAnnotation } from "./render";

const RESOLVED: AttachmentResolution = {
  kind: "resolved",
  attachmentKey: "RGRPDF24",
  itemKey: "SAKIMA22",
  openable: true,
};

/** A highlight on page four, and one that spills over the break onto page six. */
const HIGHLIGHT = annotation("HIGHL234", "highlight", {
  pageIndex: 3,
  rects: [[100, 600, 500, 640]],
});
const SPILLED = annotation("SPILL234", "highlight", {
  pageIndex: 4,
  rects: [[100, 80, 500, 120]],
  nextPageRects: [[100, 700, 500, 740]],
});
/** An Annotation whose position this build draws nowhere. */
const UNPLACED = annotation("UNPLC234", "highlight", {});

/**
 * The pages those two draw on, written out rather than grouped, so the page
 * this module answers is pinned by the fixture and not by the grouping.
 */
const MARKS = new Map<number, PdfPageAnnotation[]>([
  [3, [placement(HIGHLIGHT)]],
  [4, [placement(SPILLED)]],
  [5, [placement(SPILLED)]],
]);

function placement(record: AnnotationRecord): PdfPageAnnotation {
  return {
    annotation: record,
    position: record.position as PdfPageAnnotation["position"],
    rects: [],
  };
}

function landing(
  anchor: { page?: number | null; annotation?: string | null },
  {
    records = [HIGHLIGHT, SPILLED, UNPLACED],
    attachment = RESOLVED,
    marks = MARKS,
    rendered = [3],
    read = true,
  }: {
    records?: readonly AnnotationRecord[];
    attachment?: AttachmentResolution;
    marks?: ReadonlyMap<number, readonly PdfPageAnnotation[]>;
    rendered?: readonly number[];
    read?: boolean;
  } = {},
) {
  return decideMarkLanding({
    anchor: {
      page: anchor.page ?? null,
      annotation: anchor.annotation ?? null,
    },
    attachment,
    read,
    records,
    marks,
    rendered: new Set(rendered),
  });
}

describe("decideMarkLanding", () => {
  it("does nothing for an open that named no Annotation", () => {
    expect(landing({ page: 4 })).toEqual({ kind: "drop" });
  });

  it("selects the Mark when its page is already rendered", () => {
    expect(landing({ page: 4, annotation: "HIGHL234" })).toEqual({
      kind: "select",
      annotationKey: "HIGHL234",
      pageIndex: 3,
    });
  });

  it("waits for the page when it has not rendered yet", () => {
    expect(
      landing({ page: 5, annotation: "SPILL234" }, { rendered: [3] }),
    ).toEqual({ kind: "wait", annotationKey: "SPILL234", pageIndex: 4 });
  });

  // The Indexed Key is the durable identity and the page number is a hint, so
  // a link written before the PDF was replaced still lands on its Annotation.
  it("lands on the Annotation's own page when the link's page disagrees", () => {
    expect(landing({ page: 1, annotation: "HIGHL234" })).toMatchObject({
      kind: "select",
      pageIndex: 3,
    });
  });

  it("lands on the first page of a Mark that spilled over the break", () => {
    expect(
      landing({ annotation: "SPILL234" }, { rendered: [4, 5] }),
    ).toMatchObject({ kind: "select", pageIndex: 4 });
  });

  it("leaves the page to Obsidian for an Annotation Zotero no longer has", () => {
    expect(landing({ page: 4, annotation: "MISSING2" })).toEqual({
      kind: "page",
      reason: "annotation-unknown",
    });
  });

  it("leaves the page to Obsidian for an Annotation of another Attachment", () => {
    expect(
      landing(
        { page: 4, annotation: "HIGHL234" },
        { records: [SPILLED], marks: new Map([[4, [placement(SPILLED)]]]) },
      ),
    ).toEqual({ kind: "page", reason: "annotation-unknown" });
  });

  it("leaves the page to Obsidian for a position this build draws nowhere", () => {
    expect(landing({ page: 4, annotation: "UNPLC234" })).toEqual({
      kind: "page",
      reason: "annotation-unplaced",
    });
  });

  // An Attachment with no Annotations and an Annotation Source still loading
  // both answer an empty list, and only one of them is final.
  it("leaves the page to Obsidian while the Annotations are still being read", () => {
    expect(
      landing(
        { page: 4, annotation: "HIGHL234" },
        { read: false, records: [], marks: new Map() },
      ),
    ).toEqual({ kind: "page", reason: "annotations-pending" });
  });

  it("leaves the page to Obsidian while Zotero has not answered yet", () => {
    expect(
      landing(
        { page: 4, annotation: "HIGHL234" },
        { attachment: { kind: "pending" }, records: [], marks: new Map() },
      ),
    ).toEqual({ kind: "page", reason: "attachment-pending" });
  });

  it("leaves the page to Obsidian for a file Zotero does not know", () => {
    expect(
      landing(
        { page: 4, annotation: "HIGHL234" },
        { attachment: { kind: "unresolved" }, records: [], marks: new Map() },
      ),
    ).toEqual({ kind: "page", reason: "attachment-unknown" });
  });
});
