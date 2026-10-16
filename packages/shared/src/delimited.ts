// Delimited text: rows of text cells as CSV or TSV. Every CSV and TSV that
// ZotLit writes goes through here, so each quotes and ends a line the same way.
//
// The quoting follows denoland/std `csv/stringify.ts` (@std/csv 1.0.6).
// Original implementation © 2018-2026 the Deno authors, MIT License.

/** The delimited text formats: comma-separated and tab-separated. */
export const DELIMITED_FORMATS = ["csv", "tsv"] as const;
export type DelimitedFormat = (typeof DELIMITED_FORMATS)[number];

// A code, not the character: a formatter writes an escape as the character.
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/**
 * CSV is RFC 4180 as a spreadsheet opens it: CRLF, and a byte order mark so
 * that Excel reads the text as UTF-8. TSV is the plain text a spreadsheet
 * takes on paste: LF, and no byte order mark.
 */
const FORMATS: Record<
  DelimitedFormat,
  { separator: string; newline: string; bom: string }
> = {
  csv: { separator: ",", newline: "\r\n", bom: BYTE_ORDER_MARK },
  tsv: { separator: "\t", newline: "\n", bom: "" },
};

/**
 * One cell: quoted, with each quote doubled, where it holds the separator, a
 * quote, a line feed, or a carriage return.
 */
function cellText(cell: string, separator: string): string {
  return cell.includes(separator) || /["\n\r]/.test(cell)
    ? `"${cell.replaceAll('"', '""')}"`
    : cell;
}

/** The text that starts a whole text of `format`: its byte order mark, if any. */
export function delimitedStart(format: DelimitedFormat): string {
  return FORMATS[format].bom;
}

/**
 * The lines as `format`, each line ended by the newline of the format, with no
 * byte order mark: a part of a text that `delimitedStart` began.
 */
export function delimitedLines(
  lines: readonly (readonly string[])[],
  format: DelimitedFormat,
): string {
  const { separator, newline } = FORMATS[format];
  return lines
    .map(
      (line) =>
        line.map((cell) => cellText(cell, separator)).join(separator) + newline,
    )
    .join("");
}

/** The lines as a whole text of `format`, its byte order mark first. */
export function delimited(
  lines: readonly (readonly string[])[],
  format: DelimitedFormat,
): string {
  return delimitedStart(format) + delimitedLines(lines, format);
}
