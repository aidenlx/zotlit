// The narrow handoff of one open PDF view's document to excerpt work: the
// reader keeps ownership of the document, its pages, and its visible render
// tasks, and this module reads only.

import type { PDFDocumentProxy, PDFViewerController } from "obsidian";

import { getLogger } from "@/lib/log";
import type {
  BorrowedExcerptDocument,
  ExcerptCropPage,
} from "@/services/excerpt-image/reader-borrow";

import { pdfDocumentOf } from "./seam";

const logger = getLogger("pdf-annotation-editor");

/**
 * The document this view holds for its file, as excerpt work may borrow it.
 * Answers `null` while no document is open yet, which is what a reader still
 * loading its file — or one whose document Obsidian has not built — gives.
 *
 * The handle follows the view rather than snapshotting it: a page read asks
 * again whether the same document is still the open one, so a reader that
 * closes or swaps files withdraws the borrow at its next read.
 *
 * @see apps/obsidian/docs/adr/0054-reader-and-detached-excerpts-share-cache-publication.md
 */
export function borrowReaderDocument(options: {
  /** The view's live controller; `null` once the leaf closed. */
  controller: () => PDFViewerController | null;
  /** The open file's absolute path; `null` while the view holds no file. */
  path: string | null;
}): BorrowedExcerptDocument | null {
  const { controller, path } = options;
  const viewer = controller();
  if (!viewer || !path) return null;
  const document_ = pdfDocumentOf(viewer);
  if (!document_) return null;
  return {
    path,
    document: document_,
    bytes: () => documentBytes(document_),
    page: (pageIndex) => cropPage({ viewer, document_, pageIndex }),
  };
}

/**
 * The bytes this exact document holds, from PDF.js's own `getData()`. `null`
 * when the build does not answer it or the document closed first, which leaves
 * the document unprovable rather than trusted.
 */
async function documentBytes(
  document_: PDFDocumentProxy,
): Promise<Uint8Array | null> {
  if (typeof document_.getData !== "function") return null;
  try {
    const data: unknown = await document_.getData();
    return data instanceof Uint8Array ? data : null;
  } catch (error) {
    logger.debug("The reader's document did not answer its own bytes", {
      error,
    });
    return null;
  }
}

/** One page of the borrowed document, unless the reader moved on from it. */
async function cropPage(options: {
  viewer: PDFViewerController;
  document_: PDFDocumentProxy;
  pageIndex: number;
}): Promise<ExcerptCropPage | null> {
  const { viewer, document_, pageIndex } = options;
  if (pdfDocumentOf(viewer) !== document_) return null;
  try {
    return await document_.getPage(pageIndex + 1);
  } catch (error) {
    logger.debug("The reader's document did not answer a page", {
      page: pageIndex + 1,
      error,
    });
    return null;
  }
}
