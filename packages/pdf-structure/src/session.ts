// One Reader Session's view of a PDF: Structured Characters computed lazily
// per page and memoized, with the Sort Index and Page Label they feed.

import { getLogger } from "@logtape/logtape";

import type { ObsidianTextItem, StructuredPage } from "@/chars";
import { structurePage } from "@/chars";
import type { PageLabelSource, PreviousAnnotation } from "@/page-label";
import { alignPageLabel, extractPageLabels } from "@/page-label";
import type { PdfPosition } from "@/sort-index";
import { computeSortIndex } from "@/sort-index";

const logger = getLogger(["zotlit", "pdf-structure"]);

/** The open document, as the Obsidian reader seam exposes it. */
export interface PdfPageSource extends PageLabelSource {
  /** `page.getTextContent({ includeChars: true })` for a zero-based page. */
  getTextItems(pageIndex: number): Promise<readonly ObsidianTextItem[]>;
}

/**
 * The memo the Reader Session owns. Structuring a page costs a full text
 * extraction plus the line grouping, and a session revisits the same pages, so
 * the work is kept for as long as the session lives and no longer.
 *
 * The default is a plain `Map`; a host with its own per-session store — the
 * Reader Session of ticket #1146 — supplies that instead.
 */
export interface StructuredPageCache {
  get(pageIndex: number): Promise<StructuredPage> | undefined;
  set(pageIndex: number, page: Promise<StructuredPage>): void;
}

export function createStructuredPageCache(): StructuredPageCache {
  return new Map<number, Promise<StructuredPage>>();
}

/**
 * Everything a creation in Obsidian needs to name where it sits in Zotero's
 * reading order. One instance belongs to one Reader Session.
 */
export class PdfTextStructure {
  readonly #source: PdfPageSource;
  readonly #cache: StructuredPageCache;
  readonly #emptyPagesLogged = new Set<number>();
  #pageLabels: Promise<readonly string[]> | null = null;

  constructor(
    source: PdfPageSource,
    cache: StructuredPageCache = createStructuredPageCache(),
  ) {
    this.#source = source;
    this.#cache = cache;
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

  /** The Page Label a creation on this page gets. */
  async pageLabel(
    pageIndex: number,
    previous: readonly PreviousAnnotation[],
  ): Promise<string> {
    return alignPageLabel(await this.pageLabels(), pageIndex, previous);
  }
}
