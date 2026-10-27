/**
 * Optional OCR hook for scanned / image-only pages.
 *
 * Documented integration point for paddleocr-js (PP-OCRv5/v6) or a local
 * PaddleX pipeline. NOT required for the default e2e demo.
 *
 * Enable with ZOTLIT_OCR_HOOK=1. Replace the body with a real call, e.g.:
 *   import { OCR } from 'paddleocr-js'; ...
 *
 * License note: PaddleOCR is Apache-2.0 — keep it as an optional dependency,
 * do not vendor AGPL document-worker code here.
 */
export async function ocrPage(_pdfPath, _pageIndex) {
  if (process.env.ZOTLIT_OCR_HOOK !== '1') return null;
  console.warn('[ocr-hook] ZOTLIT_OCR_HOOK=1 but no paddleocr-js backend wired; skipping');
  return null;
}
