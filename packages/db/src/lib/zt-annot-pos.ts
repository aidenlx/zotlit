import type { AnnotationPositionRaw } from "@drizzle/schema";
import * as v from "valibot";

const RectSchema = v.tuple([v.number(), v.number(), v.number(), v.number()]);

/**
 * PDF ink annotation position. The reader has no TS type for this shape; the
 * JSON is built inline at the ink-tool `pointerdown` handler, then `paths` is
 * extended on each `pointermove`.
 *
 * @see https://github.com/zotero/reader/blob/9375b4f2bb89b4187adcb6eca209119a1dedf81a/src/pdf/pdf-view.js#L2541-L2545
 */
const PdfInkSchema = v.pipe(
  v.object({
    pageIndex: v.number(),
    width: v.number(),
    paths: v.array(v.array(v.number())),
  }),
  v.transform((o) => ({ kind: "pdf-ink" as const, ...o })),
);
export type PdfInkPosition = v.InferOutput<typeof PdfInkSchema>;

/**
 * PDF free-text annotation position. The reader has no TS type for this shape;
 * the JSON is built inline at the text-tool `pointerdown` handler, padding the
 * caret rect by half the font size.
 *
 * @see https://github.com/zotero/reader/blob/9375b4f2bb89b4187adcb6eca209119a1dedf81a/src/pdf/pdf-view.js#L2516-L2526
 */
const PdfTextSchema = v.pipe(
  v.object({
    pageIndex: v.number(),
    rects: v.array(RectSchema),
    fontSize: v.number(),
    rotation: v.number(),
  }),
  v.transform((o) => ({ kind: "pdf-text" as const, ...o })),
);
export type PdfTextPosition = v.InferOutput<typeof PdfTextSchema>;

/**
 * PDF rect-based annotation position (highlight / underline / note / image).
 * The reader's only PDF-position type — `PDFPosition` in `src/common/types.ts`
 * — has optional `rects`, `paths`, and `nextPageRects` fields. Continuation
 * rectangles belong to the page after `pageIndex`.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/common/types.ts#L68-L79
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/selection.js#L757-L782
 */
const PdfRectsSchema = v.pipe(
  v.object({
    pageIndex: v.number(),
    rects: v.array(RectSchema),
    nextPageRects: v.optional(v.array(RectSchema)),
  }),
  v.transform((o) => ({ kind: "pdf-rects" as const, ...o })),
);
export type PdfRectsPosition = v.InferOutput<typeof PdfRectsSchema>;

/**
 * EPUB annotation position. The reader models WADM selectors as TS types in
 * `src/dom/common/lib/selector.ts`; this is the `FragmentSelector` variant,
 * carrying an EPUB CFI string. Constructed in the EPUB view's
 * `toSelector(range)` from the resolved CFI.
 *
 * @see https://github.com/zotero/reader/blob/9375b4f2bb89b4187adcb6eca209119a1dedf81a/src/dom/common/lib/selector.ts#L10-L20
 * @see https://github.com/zotero/reader/blob/9375b4f2bb89b4187adcb6eca209119a1dedf81a/src/dom/epub/epub-view.ts#L441-L445
 */
const EpubCfiSchema = v.pipe(
  v.object({
    type: v.literal("FragmentSelector"),
    value: v.string(),
  }),
  v.transform(({ value }) => ({ kind: "epub-cfi" as const, value })),
);
export type EpubCfiPosition = v.InferOutput<typeof EpubCfiSchema>;

/**
 * Snapshot annotation position — `CssSelector` (TS type in
 * `src/dom/common/lib/selector.ts`), optionally refined by a
 * `TextPositionSelector` when the highlight is narrower than the matched
 * element. Built in the snapshot view's `toSelector(range)`.
 *
 * @see https://github.com/zotero/reader/blob/9375b4f2bb89b4187adcb6eca209119a1dedf81a/src/dom/common/lib/selector.ts#L22-L27
 * @see https://github.com/zotero/reader/blob/9375b4f2bb89b4187adcb6eca209119a1dedf81a/src/dom/snapshot/snapshot-view.ts#L353-L362
 */
const SnapshotCssSchema = v.pipe(
  v.object({
    type: v.literal("CssSelector"),
    value: v.string(),
    refinedBy: v.optional(v.object({ start: v.number(), end: v.number() })),
  }),
  v.transform(({ value, refinedBy }) => ({
    kind: "snapshot-css" as const,
    value,
    ...(refinedBy && { refinedBy }),
  })),
);
export type SnapshotCssPosition = v.InferOutput<typeof SnapshotCssSchema>;

/**
 * Snapshot annotation position — `TextPositionSelector` (TS type in
 * `src/dom/common/lib/selector.ts`). Carries character offsets into the
 * document's text; produced by `textPositionFromRange` and used either
 * standalone or as the `refinedBy` of a `CssSelector`.
 *
 * @see https://github.com/zotero/reader/blob/9375b4f2bb89b4187adcb6eca209119a1dedf81a/src/dom/common/lib/selector.ts#L40-L46
 */
const SnapshotTextSchema = v.pipe(
  v.object({
    type: v.literal("TextPositionSelector"),
    start: v.number(),
    end: v.number(),
  }),
  v.transform(({ start, end }) => ({
    kind: "snapshot-text" as const,
    start,
    end,
  })),
);
export type SnapshotTextPosition = v.InferOutput<typeof SnapshotTextSchema>;

export interface UnknownPosition {
  kind: "unknown";
  raw: unknown;
}

/**
 * `PdfTextSchema` is listed before `PdfRectsSchema` because a text position
 * structurally satisfies the rects schema — unknown keys (`fontSize`,
 * `rotation`) get stripped by `v.object`, so order disambiguates.
 */
const PdfPositionSchema = v.union([
  PdfTextSchema,
  PdfInkSchema,
  PdfRectsSchema,
]);

const SnapshotPositionSchema = v.union([SnapshotCssSchema, SnapshotTextSchema]);

export type AnnotationPosition =
  | PdfRectsPosition
  | PdfInkPosition
  | PdfTextPosition
  | EpubCfiPosition
  | SnapshotCssPosition
  | SnapshotTextPosition
  | UnknownPosition;

export function parseAnnotationPosition(
  rawPos: AnnotationPositionRaw,
  contentType: string,
): AnnotationPosition {
  const schema = schemaForContentType(contentType);
  if (!schema) return { kind: "unknown", raw: rawPos };

  const result = v.safeParse(schema, rawPos);
  return result.success ? result.output : { kind: "unknown", raw: rawPos };
}

function schemaForContentType(contentType: string) {
  switch (contentType) {
    case "application/pdf":
      return PdfPositionSchema;
    case "application/epub+zip":
      return EpubCfiSchema;
    case "text/html":
    case "application/xhtml+xml":
      return SnapshotPositionSchema;
    default:
      return null;
  }
}
