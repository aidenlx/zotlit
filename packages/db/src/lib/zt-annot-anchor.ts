// The Annotation Anchor: the one spelling of `zt-annotation` in a PDF link's
// fragment, written where an Attachment File Link is built and read where a
// Mark Landing starts, so the two cannot drift apart.
//
// @see apps/obsidian/docs/adr/0046-landing-on-a-mark-is-an-ephemeral-state-contract-read-at-the-leaf.md

import { isIndexedKey } from "./zt-key";

/** The fragment key an Annotation Anchor is written under. */
export const ANNOTATION_ANCHOR_KEY = "zt-annotation";

/** Obsidian's own page key, which the Anchor rides beside. */
const PAGE_KEY = "page";

/**
 * What an Annotation's file link anchors to: the page Obsidian jumps to, and
 * the Annotation Anchor naming the Annotation itself. Both are optional, so a
 * caller with only one of them passes only that.
 */
export interface AnnotationFileLinkAnchor {
  /** The 1-based page Obsidian jumps to; absent for a position with no page. */
  page?: number | null;
  /** The Annotation's Indexed Key, written as the `zt-annotation` key. */
  annotation?: string | null;
}

/** Both halves of a fragment, as {@link parseAnnotationSubpath} read them. */
export interface ParsedAnnotationSubpath {
  page: number | null;
  annotation: string | null;
}

/**
 * The fragment body for a link that lands on one Annotation: the page Obsidian
 * jumps to, and the Anchor Obsidian drops and ZotLit reads. A key that is no
 * Indexed Key is left out, because an Anchor no reader can resolve is worth
 * less than the page beside it.
 *
 * @returns the fragment without its `#`, for a caller that writes its own
 *   separator — a wikilink does — or `""` when there is nothing to anchor.
 */
export function formatAnnotationFragment({
  page,
  annotation,
}: AnnotationFileLinkAnchor): string {
  const params = new URLSearchParams();
  if (isPageNumber(page)) params.set(PAGE_KEY, String(page));
  if (typeof annotation === "string" && isIndexedKey(annotation)) {
    params.set(ANNOTATION_ANCHOR_KEY, annotation);
  }
  return params.toString();
}

/**
 * {@link formatAnnotationFragment} as a subpath: the same fragment with the `#`
 * that a URL and Obsidian's own `eState.subpath` both carry, and `""` when
 * there is nothing to anchor.
 */
export function formatAnnotationSubpath(
  anchor: AnnotationFileLinkAnchor,
): string {
  const fragment = formatAnnotationFragment(anchor);
  return fragment === "" ? "" : `#${fragment}`;
}

/**
 * The page and the Anchor a fragment carries. Every other key — Obsidian's
 * `offset`, `selection`, `height` and its own PDF-native `annotation` — is
 * left where it is, because Obsidian reads those by name itself.
 *
 * @param subpath the fragment, with or without its leading `#`.
 */
export function parseAnnotationSubpath(
  subpath: string | null | undefined,
): ParsedAnnotationSubpath {
  const params = new URLSearchParams(
    subpath?.startsWith("#") === true ? subpath.slice(1) : (subpath ?? ""),
  );
  const page = params.has(PAGE_KEY) ? Number(params.get(PAGE_KEY)) : null;
  const annotation = params.get(ANNOTATION_ANCHOR_KEY);
  return {
    page: isPageNumber(page) ? page : null,
    annotation:
      annotation !== null && isIndexedKey(annotation) ? annotation : null,
  };
}

/** A 1-based page number, which is the only page a fragment can name. */
function isPageNumber(page: number | null | undefined): page is number {
  return typeof page === "number" && Number.isInteger(page) && page > 0;
}
