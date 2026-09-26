// Generates the External Annotation PDF by hand, byte-for-byte deterministic
// (no timestamps beyond the fixed `/M`, no random ids), so its committed
// SHA-256 never drifts across regeneration. See NOTICE.md for what the file
// holds and how to reproduce it.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** One PDF object body, without the `N 0 obj` / `endobj` wrapper. */
type PdfObject = string;

function contentStream(content: string): PdfObject {
  const length = Buffer.byteLength(content, "latin1");
  return `<< /Length ${length} >>\nstream\n${content}\nendstream`;
}

/** Assembles a classic-xref, uncompressed PDF from object bodies in order. */
function buildPdf(objects: readonly PdfObject[]): Buffer {
  const header = "%PDF-1.4\n";
  const offsets: number[] = [0];
  let body = "";
  let offset = Buffer.byteLength(header, "latin1");
  objects.forEach((objectBody, index) => {
    offsets.push(offset);
    const objectText = `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
    body += objectText;
    offset += Buffer.byteLength(objectText, "latin1");
  });
  const xrefOffset =
    Buffer.byteLength(header, "latin1") + Buffer.byteLength(body, "latin1");
  const entryCount = objects.length + 1;
  let xref = `xref\n0 ${entryCount}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber < entryCount; objectNumber++) {
    xref += `${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${entryCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(header + body + xref + trailer, "latin1");
}

const TIMES_ROMAN =
  "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>";

// Two 12 pt lines, 40 pt apart, so the highlight's band holds the first
// line's glyphs alone.
const content =
  "BT\n/F1 12 Tf\n1 0 0 1 72 700 Tm\n(Another PDF reader highlighted this sentence.) Tj\nET\n" +
  "BT\n/F1 12 Tf\n1 0 0 1 72 660 Tm\n(Zotero imports that highlight as an external annotation.) Tj\nET\n";

// A plain markup highlight, as another PDF reader saves one: no Zotero key,
// so Zotero imports it as an External Annotation and keeps it read-only.
const highlight =
  "<< /Type /Annot /Subtype /Highlight /F 4 /P 3 0 R" +
  " /Rect [68 695 540 712]" +
  " /QuadPoints [68 712 540 712 68 695 540 695]" +
  " /C [1 0.831 0]" +
  " /Contents (Noted in another PDF reader.)" +
  " /M (D:20250101120000Z) >>";

const pdf = buildPdf([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R] >>",
  TIMES_ROMAN,
  contentStream(content),
  highlight,
]);

writeFileSync(join(import.meta.dirname, "external-annotation.pdf"), pdf);
