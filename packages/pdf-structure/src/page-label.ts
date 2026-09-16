// The printed-page heuristic over the first 25 pages, and the reader's
// alignment of a fresh Annotation's Page Label to the previous one.

import type { Rect, StructuredChar } from "@/chars";
import type {
  PageLabelDocument,
  StructuredCharsProvider,
} from "@/vendor/page-label.js";
import { getPageLabels } from "@/vendor/page-label.js";

/** What the heuristic needs from the open document, page indexes zero-based. */
export interface PageLabelSource {
  readonly numPages: number;
  /** `page.view` — the PDF page box. */
  getViewBox(pageIndex: number): Promise<Rect>;
  /** `/PageLabels` from the PDF catalog, or `null` when the PDF carries none. */
  getCatalogPageLabels(): Promise<readonly string[] | null>;
}

/**
 * One Page Label per page. The heuristic reads the first 25 pages, so a longer
 * document is filled from the catalog, from the extracted arabic run, or from
 * the page number.
 */
export async function extractPageLabels(
  source: PageLabelSource,
  structuredChars: (pageIndex: number) => Promise<readonly StructuredChar[]>,
): Promise<readonly string[]> {
  const document: PageLabelDocument = {
    catalog: { numPages: source.numPages, pageLabels: null },
    pdfManager: { ensureCatalog: () => source.getCatalogPageLabels() },
    getPage: async (pageIndex) => ({
      view: await source.getViewBox(pageIndex),
    }),
  };
  const provider: StructuredCharsProvider = (pageIndex) =>
    structuredChars(pageIndex);
  return getPageLabels(document, provider);
}

/** An Annotation already on this Attachment, as the Annotation Source has it. */
export interface PreviousAnnotation {
  readonly pageLabel: string;
  readonly pageIndex: number;
  /** An Annotation the user cannot fix the Page Label of. */
  readonly readOnly?: boolean;
}

/**
 * Zotero's `parseInt(label) == label`, which coerces the label to a number
 * rather than the number to a string, so `"07"` still reads as page 7.
 */
function readsAsItsOwnInteger(label: string): boolean {
  return Number.parseInt(label) === Number(label);
}

/** A page range such as `12-13` or `12–13`, which the reader also accepts. */
const PAGE_RANGE = /[0-9]+[-–][0-9]+/u;

/**
 * The Page Label a creation on `pageIndex` gets: the extracted label, unless
 * the newest usable Annotation at or before that page implies a different
 * printed run, in which case the reader trusts the user's own labelling.
 *
 * Walks the Annotation Source in reverse and stops at the first Annotation that
 * is not read-only and not `-`, whether or not that one wins.
 *
 * @see https://github.com/zotero/reader/blob/132bb787937a540a09513415fd507654eb0e88f9/src/pdf/pdf-view.js#L926-L950
 */
export function alignPageLabel(
  pageLabels: readonly string[],
  pageIndex: number,
  previous: readonly PreviousAnnotation[],
): string {
  const extracted = pageLabels[pageIndex];
  let pageLabel = extracted || (pageIndex + 1).toString();

  for (let i = previous.length - 1; i >= 0; i--) {
    const annotation = previous[i]!;
    if (
      annotation.readOnly ||
      annotation.pageLabel === "-" ||
      annotation.pageIndex > pageIndex
    ) {
      continue;
    }
    const deltaPageLabel =
      Number.parseInt(extracted ?? "") -
      Number.parseInt(pageLabels[annotation.pageIndex] ?? "");
    const deltaPageIndex = pageIndex - annotation.pageIndex;
    if (
      deltaPageLabel === deltaPageIndex &&
      (readsAsItsOwnInteger(annotation.pageLabel) ||
        PAGE_RANGE.test(annotation.pageLabel))
    ) {
      pageLabel = (
        pageIndex +
        (Number.parseInt(annotation.pageLabel) - annotation.pageIndex)
      ).toString();
    }
    break;
  }

  return pageLabel;
}
