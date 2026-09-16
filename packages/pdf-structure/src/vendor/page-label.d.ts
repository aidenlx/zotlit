// Hand-written types for the pinned `page-label.js` copy, which ships as JS.

import type { Rect, StructuredChar } from "@/chars";

/** The slice of a pdf.js core document the label heuristic reads. */
export interface PageLabelDocument {
  readonly catalog: {
    readonly numPages: number;
    /** `/PageLabels`, one entry per page, or `null` when the PDF has none. */
    readonly pageLabels: readonly string[] | null;
  };
  readonly pdfManager: {
    ensureCatalog(field: "pageLabels"): Promise<readonly string[] | null>;
  };
  /** Zero-based, unlike the display API's one-based `getPage`. */
  getPage(pageIndex: number): Promise<{ readonly view: Rect }>;
}

/** Structured Characters of one zero-based page, `pageIndex` already stamped. */
export type StructuredCharsProvider = (
  pageIndex: number,
) => Promise<readonly StructuredChar[]>;

/** One printed page number the heuristic recognised on a page. */
export interface ExtractedPageLabel {
  pageIndex: number;
  type: "arabic" | "roman";
  integer: number;
  chars: readonly StructuredChar[];
}

export declare function getPageLabel(
  pdfDocument: PageLabelDocument,
  structuredCharsProvider: StructuredCharsProvider,
  pageIndex: number,
): Promise<ExtractedPageLabel | null>;

export declare function predictPageLabels(
  extractedPageLabels: readonly ExtractedPageLabel[] | null,
  catalogPageLabels: readonly string[] | null,
  pagesCount: number,
): string[];

/** Runs the heuristic over the first 25 pages, then predicts the whole run. */
export declare function getPageLabels(
  pdfDocument: PageLabelDocument,
  structuredCharsProvider: StructuredCharsProvider,
): Promise<string[]>;
