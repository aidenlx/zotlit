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
 * The handle follows the view rather than snapshotting it. `current()` asks the
 * live controller whether it still holds this document, and every read asks it
 * again — before the read, and once more after an asynchronous page read — so a
 * reader that closes, swaps its file, or drops its viewer withdraws the borrow
 * rather than answering a page of the document it moved on from.
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
  /**
   * Whether the view still stands behind this document: the controller it was
   * taken from is still the live one, and that controller still holds this
   * exact document. Read live, because a binding that withdrew or replaced its
   * controller owns no document of its own any more.
   */
  const current = (): boolean => {
    const live = controller();
    return !!live && pdfDocumentOf(live) === document_;
  };
  return {
    path,
    document: document_,
    current,
    bytes: () => documentBytes({ document_, current }),
    page: (pageIndex) => cropPage({ document_, current, pageIndex }),
  };
}

/**
 * The bytes this exact document holds, from PDF.js's own `getData()`. `null`
 * when the build does not answer it or the view no longer holds the document,
 * which leaves the document unprovable rather than trusted.
 */
async function documentBytes(options: {
  document_: PDFDocumentProxy;
  current: () => boolean;
}): Promise<Uint8Array | null> {
  const { document_, current } = options;
  if (typeof document_.getData !== "function" || !current()) return null;
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
  document_: PDFDocumentProxy;
  current: () => boolean;
  pageIndex: number;
}): Promise<ExcerptCropPage | null> {
  const { document_, current, pageIndex } = options;
  if (!current()) return null;
  try {
    const page = await document_.getPage(pageIndex + 1);
    // The reader may have closed or replaced its document while the page read
    // was in flight, and that page belongs to the document it read.
    return current() ? page : null;
  } catch (error) {
    logger.debug("The reader's document did not answer a page", {
      page: pageIndex + 1,
      error,
    });
    return null;
  }
}
