// Generates the excerpt-rendering acceptance PDFs byte-for-byte.

import type { PdfObject } from "#fixture/assets/pdf-writer";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildPdf, contentStream } from "#fixture/assets/pdf-writer";

// The committed bytes carry a PDF 1.7 header with a binary comment, a space
// before each `/Length` and trailer `>>`, and a final newline.
function stream(content: string, dictionary = ""): PdfObject {
  return contentStream(content, `${dictionary} `);
}

function excerptPdf(
  objects: readonly PdfObject[],
  trailerEntries = "",
): Buffer {
  return buildPdf(objects, {
    header: "%PDF-1.7\n%\xE2\xE3\xCF\xD3\n",
    trailerEntries: ` ${trailerEntries}`,
    finalNewline: true,
  });
}

function page(rotation: 0 | 90 | 180 | 270, content: number): PdfObject {
  return `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /CropBox [24 36 588 756] /Rotate ${rotation} /Resources << /Font << /F1 9 0 R >> /Properties << /Layer 10 0 R >> >> /Contents ${content} 0 R >>`;
}

function pageContent(label: string, color: string): string {
  return [
    "q",
    `${color} rg 24 36 564 720 re f`,
    "1 1 1 rg 42 54 528 684 re f",
    "0 0 0 rg",
    `BT /F1 22 Tf 64 700 Td (${label}) Tj ET`,
    "1 0 0 rg 70 90 120 110 re f",
    "0 0.45 0.9 rg 250 250 190 150 re f",
    "/OC /Layer BDC 0.25 0.65 0.2 rg 360 560 150 80 re f EMC",
    "Q",
  ].join("\n");
}

const valid = excerptPdf([
  "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [10 0 R] /D << /Order [10 0 R] /ON [10 0 R] >> >> /AcroForm 11 0 R >>",
  "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R 25 0 R] /Count 6 >>",
  page(0, 12).replace("/Contents 12 0 R", "/UserUnit 2 /Contents 12 0 R"),
  page(90, 13),
  page(180, 14),
  page(270, 15),
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R /CJK 18 0 R >> /Properties << /Layer 10 0 R >> >> /Annots [16 0 R 17 0 R] /Contents 20 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  "<< /Type /OCG /Name (Acceptance layer) >>",
  "<< /Fields [17 0 R] /NeedAppearances false /DA (/F1 12 Tf 0 g) >>",
  stream(pageContent("rotation 0, crop, UserUnit 2", "0.92 0.84 0.22")),
  stream(pageContent("rotation 90", "0.72 0.88 0.98")),
  stream(pageContent("rotation 180", "0.86 0.76 0.96")),
  stream(pageContent("rotation 270", "0.78 0.94 0.78")),
  "<< /Type /Annot /Subtype /Text /Rect [72 520 120 568] /Contents (Native annotation) /C [1 0.5 0] /P 7 0 R /AP << /N 23 0 R >> >>",
  "<< /Type /Annot /Subtype /Widget /FT /Tx /T (acceptance-field) /V (form value) /Rect [160 520 360 568] /P 7 0 R /DA (/F1 12 Tf 0 g) /AP << /N 24 0 R >> /AS /N >>",
  "<< /Type /Font /Subtype /Type3 /Name /CJK /PaintType 1 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /CJK1 21 0 R /CJK2 22 0 R >> /Encoding << /Type /Encoding /Differences [1 /CJK1 /CJK2] >> /FirstChar 1 /LastChar 2 /Widths [1000 1000] /Resources << /ProcSet [/PDF] >> /ToUnicode 19 0 R >>",
  stream(
    "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /ZotLitCJK def\n/CMapType 2 def\n1 begincodespacerange\n<01> <02>\nendcodespacerange\n2 beginbfchar\n<01> <6D4B>\n<02> <8BD5>\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend end",
  ),
  stream(
    "BT /F1 22 Tf 72 730 Td (embedded Type3 CJK:) Tj ET\nBT /CJK 80 Tf 72 650 Td <0102> Tj ET\n/OC /Layer BDC 0.1 0.7 0.3 rg 72 400 300 70 re f EMC",
  ),
  stream("1000 0 0 0 1000 1000 d1 0 0 1 rg 80 80 840 840 re f"),
  stream("1000 0 0 0 1000 1000 d1 1 0.3 0 rg 100 100 800 800 re f"),
  stream(
    "1 0.5 0 rg 0 0 48 48 re f",
    "/Type /XObject /Subtype /Form /BBox [0 0 48 48]",
  ),
  stream(
    "0.8 0 0.8 rg 0 0 200 48 re f",
    "/Type /XObject /Subtype /Form /BBox [0 0 200 48]",
  ),
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 3000 100] /Resources << >> /Contents 26 0 R >>",
  stream("0.15 0.25 0.75 rg 0 0 3000 100 re f"),
]);

// A deterministic malformed input. It has a PDF header and a broken xref.
const corrupt = Buffer.from(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\nstartxref\n999999\n%%EOF\n",
  "latin1",
);

// This valid trailer has a Standard security dictionary with deliberately
// fixed credentials. PDF.js must request a password before it renders it.
const encrypted = excerptPdf(
  [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
    "<< /Filter /Standard /V 1 /R 2 /Length 40 /O <5EDB3189271BF6AABEBCA4DC39A07349F9EC0210B12D83E5A88F5BB3B7745B4E> /U <37F1D18153695B4E8B4C4C13DB410FF4612C453225184372778B843798653E1C> /P -4 >>",
  ],
  "/Encrypt 4 0 R /ID [<7B1D8E7E05EA3C96AA6A01C3C2DF3DA1><7B1D8E7E05EA3C96AA6A01C3C2DF3DA1>]",
);

for (const [name, bytes] of [
  ["excerpt-rendering.pdf", valid],
  ["corrupt.pdf", corrupt],
  ["encrypted.pdf", encrypted],
] as const) {
  writeFileSync(join(import.meta.dirname, name), bytes);
  console.log(`${createHash("sha256").update(bytes).digest("hex")}  ${name}`);
}
