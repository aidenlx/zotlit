// Writes the deterministic, classic-xref, uncompressed PDFs that the Fixture
// asset generators commit.

/** One PDF object body, without the `N 0 obj` / `endobj` wrapper. */
export type PdfObject = string;

/**
 * A stream object. `entries` is written verbatim between `<< ` and
 * `/Length`, so it carries its own trailing space.
 */
export function contentStream(content: string, entries = ""): PdfObject {
  const length = Buffer.byteLength(content, "latin1");
  return `<< ${entries}/Length ${length} >>\nstream\n${content}\nendstream`;
}

export interface BuildPdfOptions {
  /**
   * Bytes before the first object.
   * @default "%PDF-1.4\n"
   */
  readonly header?: string;
  /**
   * Written verbatim between `/Root 1 0 R` and ` >>` in the trailer, so it
   * carries its own leading space.
   */
  readonly trailerEntries?: string;
  /**
   * Ends the file with a newline after `%%EOF`.
   * @default false
   */
  readonly finalNewline?: boolean;
}

export function buildPdf(
  objects: readonly PdfObject[],
  {
    header = "%PDF-1.4\n",
    trailerEntries = "",
    finalNewline = false,
  }: BuildPdfOptions = {},
): Buffer {
  const offsets: number[] = [0];
  let body = "";
  let offset = Buffer.byteLength(header, "latin1");
  objects.forEach((objectBody, index) => {
    offsets.push(offset);
    const objectText = `${index + 1} 0 obj\n${objectBody}\nendobj\n`;
    body += objectText;
    offset += Buffer.byteLength(objectText, "latin1");
  });
  const xrefOffset = offset;
  const entryCount = objects.length + 1;
  let xref = `xref\n0 ${entryCount}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber < entryCount; objectNumber++) {
    xref += `${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${entryCount} /Root 1 0 R${trailerEntries} >>\nstartxref\n${xrefOffset}\n%%EOF${finalNewline ? "\n" : ""}`;
  return Buffer.from(header + body + xref + trailer, "latin1");
}
