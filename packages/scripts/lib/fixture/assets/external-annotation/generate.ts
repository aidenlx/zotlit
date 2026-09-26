// Generates the External Annotation PDF by hand, byte-for-byte deterministic
// (no timestamps beyond the fixed `/M`, no random ids), so its committed
// SHA-256 never drifts across regeneration. See NOTICE.md for what the file
// holds and how to reproduce it.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildPdf, contentStream } from "#fixture/assets/pdf-writer";

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
