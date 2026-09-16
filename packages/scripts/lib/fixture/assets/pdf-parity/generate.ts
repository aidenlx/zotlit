// Generates the two Sort Index / Page Label parity PDFs by hand, byte-for-byte
// deterministic (no timestamps, no random ids, no `/CreationDate`), so their
// committed SHA-256 never drifts across regeneration. See NOTICE.md for what
// each file exercises and the exact commands to reproduce them.

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
const TIMES_ROMAN_LIGATURES =
  "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding << /Type /Encoding /Differences [ 1 /fi 2 /fl ] >> >>";

interface TextLinesOptions {
  readonly font: "F1" | "F2";
  readonly size: number;
  readonly leading: number;
  readonly tm: readonly [number, number, number, number, number, number];
  readonly lines: readonly string[];
}

function textLines({
  font,
  size,
  leading,
  tm,
  lines,
}: TextLinesOptions): string {
  const [a, b, c, d, e, f] = tm;
  const body = lines
    .map((line, index) =>
      index === 0 ? `(${line}) Tj\n` : `0 -${leading} Td\n(${line}) Tj\n`,
    )
    .join("");
  return `BT\n/${font} ${size} Tf\n${leading} TL\n${a} ${b} ${c} ${d} ${e} ${f} Tm\n${body}ET\n`;
}

// pdf-parity-layout.pdf: two text columns, a 90-degree rotated block, and a
// ligature line rendered through a Differences-encoded font resource.
const layoutContent =
  textLines({
    font: "F1",
    size: 12,
    leading: 14,
    tm: [1, 0, 0, 1, 60, 700],
    lines: [
      "Left column line one begins here.",
      "Left column line two continues on.",
      "Left column line three follows next.",
      "Left column line four adds more text.",
      "Left column line five keeps going on.",
      "Left column line six still has words.",
      "Left column line seven nears the end.",
      "Left column line eight completes it.",
    ],
  }) +
  textLines({
    font: "F1",
    size: 12,
    leading: 14,
    tm: [1, 0, 0, 1, 330, 700],
    lines: [
      "Right column line one starts fresh.",
      "Right column line two moves along.",
      "Right column line three keeps pace.",
      "Right column line four continues on.",
      "Right column line five stays steady.",
      "Right column line six pushes ahead.",
      "Right column line seven nears close.",
      "Right column line eight wraps it up.",
    ],
  }) +
  // "\001" / "\002" show the Differences-mapped fi/fl ligature glyphs, in an
  // empty band below the left column.
  textLines({
    font: "F2",
    size: 12,
    leading: 14,
    tm: [1, 0, 0, 1, 60, 560],
    lines: ["The \\001re and \\002ame test ligatures."],
  }) +
  // Text matrix [0 1 -1 0 tx ty] rotates the baseline 90 degrees; the empty
  // band near the right margin keeps it clear of both columns.
  textLines({
    font: "F1",
    size: 12,
    leading: 14,
    tm: [0, 1, -1, 0, 560, 100],
    lines: [
      "Rotated line one goes here.",
      "Rotated line two follows next.",
      "Rotated line three continues on.",
      "Rotated line four completes it.",
    ],
  });

const layoutPdf = buildPdf([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
  TIMES_ROMAN,
  TIMES_ROMAN_LIGATURES,
  contentStream(layoutContent),
]);

// pdf-parity-scanned.pdf: one page whose sole content is an image XObject —
// no BT/Tj/TJ operators at all, so text extraction yields no characters.
const checkerboard = Array.from({ length: 64 }, (_, index) => {
  const row = Math.floor(index / 8);
  const col = index % 8;
  return (row + col) % 2 === 0 ? "00" : "ff";
}).join("");
const imageStream = `<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${
  checkerboard.length + 1
} >>\nstream\n${checkerboard}>\nendstream`;
const scannedContent = "q 612 0 0 792 0 0 cm /Im0 Do Q\n";

const scannedPdf = buildPdf([
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
  imageStream,
  contentStream(scannedContent),
]);

writeFileSync(join(import.meta.dirname, "pdf-parity-layout.pdf"), layoutPdf);
writeFileSync(join(import.meta.dirname, "pdf-parity-scanned.pdf"), scannedPdf);
