// One Reader Session's view of a PDF: Structured Characters computed lazily
// per page and memoized, with the Sort Index and Page Label they feed.

import { getLogger } from "@logtape/logtape";

import type { ObsidianTextItem, StructuredPage } from "@/chars";
import { structurePage } from "@/chars";
import type { PageLabelSource, PreviousAnnotation } from "@/page-label";
import { alignPageLabel, extractPageLabels } from "@/page-label";
import type { PdfPosition } from "@/sort-index";
import { computeSortIndex } from "@/sort-index";
import type {
  RangeAdjustment,
  SelectedText,
  TextSelection,
} from "@/text-selection";
import { adjustRange, selectText } from "@/text-selection";

const logger = getLogger(["zotlit", "pdf-structure"]);

/** The open document, as the Obsidian reader seam exposes it. */
export interface PdfPageSource extends PageLabelSource {
  /** `page.getTextContent({ includeChars: true })` for a zero-based page. */
  getTextItems(pageIndex: number): Promise<readonly ObsidianTextItem[]>;
}

/**
 * Everything a creation in Obsidian needs to name where it sits in Zotero's
 * reading order. One instance belongs to one Reader Session.
 */
export class PdfTextStructure {
  readonly #source: PdfPageSource;
  /**
   * The session's own memo. Structuring a page costs a full text extraction
   * plus the line grouping, and a session revisits the same pages, so the work
   * is kept for as long as the session lives and no longer.
   */
  readonly #cache = new Map<number, Promise<StructuredPage>>();
  readonly #emptyPagesLogged = new Set<number>();
  #pageLabels: Promise<readonly string[]> | null = null;

  constructor(source: PdfPageSource) {
    this.#source = source;
  }

  /** The page's Structured Characters, computed once per Reader Session. */
  page(pageIndex: number): Promise<StructuredPage> {
    const cached = this.#cache.get(pageIndex);
    if (cached) return cached;
    const page = this.#structure(pageIndex);
    this.#cache.set(pageIndex, page);
    return page;
  }

  async #structure(pageIndex: number): Promise<StructuredPage> {
    const [viewBox, items] = await Promise.all([
      this.#source.getViewBox(pageIndex),
      this.#source.getTextItems(pageIndex),
    ]);
    return structurePage(pageIndex, viewBox, items);
  }

  /**
   * One Page Label per page. The first call starts the pass, so the host runs
   * it in idle time once the document has loaded (`void structure.pageLabels()`)
   * and a creation that arrives before it finishes awaits the same pass.
   */
  pageLabels(): Promise<readonly string[]> {
    this.#pageLabels ??= extractPageLabels(this.#source, async (pageIndex) => {
      const page = await this.page(pageIndex);
      return page.chars;
    });
    return this.#pageLabels;
  }

  /**
   * The Sort Index Zotero's reader would give this position.
   *
   * A page with no text layer has no glyph to measure against, so the offset
   * stays `000000` and only the geometry orders the Annotation. That is
   * Zotero's own behaviour, so it is a debug line and no user-facing state,
   * reported once per page for each Reader Session.
   */
  async sortIndex(position: PdfPosition): Promise<string> {
    const page = await this.page(position.pageIndex);
    if (!page.chars.length && !this.#emptyPagesLogged.has(page.pageIndex)) {
      this.#emptyPagesLogged.add(page.pageIndex);
      logger.debug("Page carries no text layer; Sort Index offset stays 0", {
        pageIndex: page.pageIndex,
      });
    }
    return computeSortIndex(page, position);
  }

  /**
   * What a DOM text selection creates, from the Structured Characters of the
   * pages it reaches, or `null` for one they cannot place.
   */
  async selectText(selection: TextSelection): Promise<SelectedText | null> {
    const pages = await Promise.all(
      selection.pages.map(({ pageIndex }) => this.page(pageIndex)),
    );
    return selectText(
      selection,
      new Map(pages.map((page) => [page.pageIndex, page])),
    );
  }

  /**
   * A highlight or underline with one end dragged to a point, from the
   * Structured Characters of its page and, where the range or the point
   * reaches it, the page after; `null` for one they cannot place.
   */
  async adjustRange(adjustment: RangeAdjustment): Promise<SelectedText | null> {
    const { position, point } = adjustment;
    const spills =
      position.nextPageRects !== undefined ||
      point.pageIndex === position.pageIndex + 1;
    const indexes =
      spills && position.pageIndex + 1 < this.#source.numPages
        ? [position.pageIndex, position.pageIndex + 1]
        : [position.pageIndex];
    const pages = await Promise.all(
      indexes.map((pageIndex) => this.page(pageIndex)),
    );
    return adjustRange(
      adjustment,
      new Map(pages.map((page) => [page.pageIndex, page])),
    );
  }

  /** The Page Label a creation on this page gets. */
  async pageLabel(
    pageIndex: number,
    previous: readonly PreviousAnnotation[],
  ): Promise<string> {
    return alignPageLabel(await this.pageLabels(), pageIndex, previous);
  }
}
