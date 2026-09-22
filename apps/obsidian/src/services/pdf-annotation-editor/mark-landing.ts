// What an Annotation Anchor asks one PDF view to do, decided from data alone:
// the Mark to select, the page it sits on, and whether that page is on screen
// yet. The binding acts on the answer; nothing is read off the reader here.
//
// @see apps/obsidian/docs/adr/0046-landing-on-a-mark-is-an-ephemeral-state-contract-read-at-the-leaf.md

import type { ParsedAnnotationSubpath } from "@zotlit/db";

import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type { AttachmentResolution } from "@/services/attachment-resolver/service";

import type { PdfPageAnnotation } from "./render";

/** Why an Anchor lands on its page alone, as the debug record names it. */
export type MarkLandingMiss =
  | "attachment-pending"
  | "attachment-unknown"
  | "annotations-pending"
  | "annotation-unknown"
  | "annotation-unplaced";

/** The Mark a Landing aims at, and the zero-based page that draws it. */
export interface MarkLandingTarget {
  annotationKey: string;
  pageIndex: number;
}

/**
 * What one view does with the Anchor an open carried. `page` is the whole
 * degradation ladder: Obsidian's own `#page=N` has already fired, so leaving
 * the reader where it is *is* the fallback.
 */
export type MarkLanding =
  | { kind: "drop" }
  | { kind: "page"; reason: MarkLandingMiss }
  | ({ kind: "wait" } & MarkLandingTarget)
  | ({ kind: "select" } & MarkLandingTarget);

/** What a Mark Landing is judged from, with no Obsidian objects in it. */
export interface MarkLandingInput {
  /** The fragment the open carried, as the Anchor codec read it. */
  anchor: ParsedAnnotationSubpath;
  /** What the open file resolved to in Zotero. */
  attachment: AttachmentResolution;
  /**
   * Whether a read of this Attachment's Annotations has answered yet. An empty
   * list reads the same as no list at all, and the two mean opposite things:
   * an Attachment with no Annotations, or an Annotation Source still loading.
   */
  read: boolean;
  /** This Attachment's Annotations, as the last read answered. */
  records: readonly AnnotationRecord[];
  /** Those Annotations keyed by the page that draws them. */
  marks: ReadonlyMap<number, readonly PdfPageAnnotation[]>;
  /** The zero-based pages PDF.js has built. */
  rendered: ReadonlySet<number>;
}

/**
 * Decide one Anchor. The Annotation's own page wins over the page the link
 * recorded, because the Indexed Key is the durable identity and the page
 * number is a hint that a replaced PDF can outdate.
 */
export function decideMarkLanding({
  anchor,
  attachment,
  read,
  records,
  marks,
  rendered,
}: MarkLandingInput): MarkLanding {
  const annotationKey = anchor.annotation;
  if (annotationKey === null) return { kind: "drop" };
  if (attachment.kind === "pending")
    return { kind: "page", reason: "attachment-pending" };
  if (attachment.kind !== "resolved")
    return { kind: "page", reason: "attachment-unknown" };
  if (!read) return { kind: "page", reason: "annotations-pending" };

  const pageIndex = firstPageOf(marks, annotationKey);
  if (pageIndex === null) {
    return {
      kind: "page",
      reason: records.some((record) => record.key === annotationKey)
        ? "annotation-unplaced"
        : "annotation-unknown",
    };
  }
  return rendered.has(pageIndex)
    ? { kind: "select", annotationKey, pageIndex }
    : { kind: "wait", annotationKey, pageIndex };
}

/**
 * The lowest page this Annotation draws on, which is where its quote starts —
 * a highlight that spilled over a page break carries half of itself on each of
 * its two pages.
 */
function firstPageOf(
  marks: ReadonlyMap<number, readonly PdfPageAnnotation[]>,
  annotationKey: string,
): number | null {
  let first: number | null = null;
  for (const [pageIndex, annotations] of marks) {
    if (!annotations.some(({ annotation }) => annotation.key === annotationKey))
      continue;
    if (first === null || pageIndex < first) first = pageIndex;
  }
  return first;
}
