// The golden oracle: runs Zotero's pinned pdf.js and its text-structure and
// page-label modules over one PDF, straight from a local Zotero checkout, and
// writes what they produced to stdout as JSON.
//
// Usage: node --import ./oracle/register.mjs ./oracle/extract.mjs <file.pdf>
// with ZOTLIT_ZOTERO_CHECKOUT naming the checkout root.

import { readFile } from "node:fs/promises";

import { fingerprint } from "./fingerprint.mjs";

// pdf.js reaches for browser globals while loading its rendering modules, none
// of which text extraction runs.
globalThis.DOMMatrix ??= class DOMMatrix {};
globalThis.Path2D ??= class Path2D {};
Math.sumPrecise ??= (values) => values.reduce((sum, value) => sum + value, 0);

const src = `${process.env.ZOTLIT_ZOTERO_CHECKOUT}/reader/pdfjs/pdf.js/src`;

// Set before the display API loads: its static initialiser reaches for the
// build-time `PDFJSDev` constant when `workerSrc` is still empty.
const { GlobalWorkerOptions } = await import(
  `${src}/display/worker_options.js`
);
GlobalWorkerOptions.workerSrc = `${src}/pdf.worker.js`;

const { getDocument } = await import(`${src}/pdf.js`);
const { getStructuredChars } = await import(`${src}/core/module/structure.js`);
const { getPageLabels } = await import(`${src}/core/module/page-label.js`);

const [pdfPath] = process.argv.slice(2);
const data = new Uint8Array(await readFile(pdfPath));
const pdfDocument = await getDocument({
  data,
  useWorkerFetch: false,
  isEvalSupported: false,
}).promise;

const catalogPageLabels = await pdfDocument.getPageLabels();

const pages = [];
for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex++) {
  const page = await pdfDocument.getPage(pageIndex + 1);
  const { items } = await page.getTextContent();
  pages.push({
    viewBox: page.view,
    items: items
      .filter((item) => item.chars?.length)
      .map(({ transform, chars }) => ({
        transform,
        chars: chars.map(
          ({ c, u, rect, fontSize, fontName, rotation, baseline }) => ({
            c,
            u,
            rect,
            fontSize,
            fontName,
            rotation,
            baseline,
          }),
        ),
      })),
  });
}

// The structuring mutates the characters it is given, so it runs on a copy and
// after the raw records above have been captured.
const structured = pages.map(({ items }) =>
  getStructuredChars(
    items.flatMap((item) => item.chars.map((c) => ({ ...c }))),
  ),
);

for (const [pageIndex, chars] of structured.entries()) {
  for (const char of chars) char.pageIndex = pageIndex;
}

// Built here rather than borrowed from `src/page-label.ts`: a shim shared with
// the port would put the port on both sides of the comparison.
const pageLabels = await getPageLabels(
  {
    catalog: { numPages: pdfDocument.numPages, pageLabels: null },
    pdfManager: { ensureCatalog: () => catalogPageLabels },
    getPage: async (pageIndex) => ({ view: pages[pageIndex].viewBox }),
  },
  (pageIndex) => Promise.resolve(structured[pageIndex]),
);

process.stdout.write(
  JSON.stringify({
    numPages: pdfDocument.numPages,
    catalogPageLabels,
    pageLabels,
    pages: pages.map(({ viewBox, items }, pageIndex) => ({
      viewBox,
      items,
      structured: structured[pageIndex].map(fingerprint),
    })),
  }),
);
