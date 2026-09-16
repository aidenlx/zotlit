// The open PDF as the Sort Index and Page Label port reads it: Obsidian's
// per-glyph text content, the page boxes, and the catalog's page labels.
//
// @see apps/obsidian/docs/adr/0040-the-sort-index-and-page-label-are-computed-in-obsidian-from-a-port-of-zoteros-text-structure.md
import type { PDFDocumentProxy, PDFPageProxy } from "obsidian";

import type {
  ObsidianTextItem,
  PdfPageSource,
  Rect,
} from "@zotlit/pdf-structure";

import { getLogger } from "@/lib/log";

const logger = getLogger("pdf-annotation-editor");

/**
 * The document as the port's source, page indexes zero-based throughout.
 *
 * Every page is read from the document rather than from a rendered page view,
 * because the Page Label heuristic walks the first 25 pages and a reader shows
 * one of them at a time.
 */
export function pdfPageSource(document_: PDFDocumentProxy): PdfPageSource {
  return {
    numPages: document_.numPages,
    getViewBox: async (pageIndex) =>
      (await document_.getPage(pageIndex + 1)).view as unknown as Rect,
    getTextItems: async (pageIndex) => {
      const page = await document_.getPage(pageIndex + 1);
      const { items } = await page.getTextContent({ includeChars: true });
      return items.map((item) => textItem(page, item));
    },
    getCatalogPageLabels: () => document_.getPageLabels(),
  };
}

/**
 * One chunk of text content in the shape the port's four filter rules take.
 *
 * `fontName` is the **base** font name, which is what Zotero's own extraction
 * records: PDF.js names a chunk by the loaded name it gave that font object,
 * and two loaded names can stand for one base font. The port compares font
 * names for equality alone, and only to decide whether two paragraphs are
 * really one, so a font whose object has not reached the store yet keeps its
 * loaded name — a page's operator list resolves the font, which is to say the
 * page's own render does.
 */
function textItem(
  page: PDFPageProxy,
  item: { chars?: { c: string; u: string; r: number[] }[] } & {
    transform: number[];
    fontName: string;
  },
): ObsidianTextItem {
  return {
    transform: item.transform,
    fontName: baseFontName(page, item.fontName),
    chars: item.chars as ObsidianTextItem["chars"],
  };
}

function baseFontName(page: PDFPageProxy, loadedName: string): string {
  if (!page.commonObjs.has(loadedName)) {
    logger.debug("PDF font is not resolved yet; keeping its loaded name", {
      loadedName,
    });
    return loadedName;
  }
  return page.commonObjs.get(loadedName)?.name ?? loadedName;
}
