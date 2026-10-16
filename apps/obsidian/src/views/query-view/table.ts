// The rows of a Query View as a table of text: one column for each visible
// property, in the view's order. "Copy to clipboard" and "Export CSV…" write
// this table.
import { delimited } from "@zotlit/shared/delimited";

import type { QueryViewRow } from "@/services/item-query/query-view";

import { cellText } from "./value-text";
import type { PropertyEntry } from "./view-properties";

export interface ResultTable {
  readonly header: readonly string[];
  readonly body: readonly (readonly string[])[];
}

/**
 * The table of `rows`, in their order, with one column for each entry of
 * `columns`. The header names each column by its label, as the view shows it.
 */
export function resultTable(
  rows: readonly QueryViewRow[],
  columns: readonly Pick<PropertyEntry, "path" | "label">[],
): ResultTable {
  return {
    header: columns.map(({ label }) => label),
    // A row of no columns has no cell to write: a view that shows no
    // property writes an empty table.
    body:
      columns.length === 0
        ? []
        : rows.map((row) =>
            columns.map(({ path }) => cellText(path, row.values[path])),
          ),
  };
}

/** The table as CSV, the header first. */
export function toCSV(table: ResultTable): string {
  return delimited([table.header, ...table.body], "csv");
}

/**
 * The table as tab-separated text, which a spreadsheet takes on paste. A paste
 * lands at the cursor, so the text ends after the last cell, with no newline;
 * a cell that ends with one is quoted, so only the line end is cut.
 */
export function toTSV(table: ResultTable): string {
  return delimited([table.header, ...table.body], "tsv").slice(0, -1);
}

function escapeHTML(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The table as an HTML table, which a rich editor takes on paste. */
export function toHTML(table: ResultTable): string {
  const cells = (line: readonly string[], tag: "th" | "td") =>
    line.map((text) => `<${tag}>${escapeHTML(text)}</${tag}>`).join("");
  return `<table><thead><tr>${cells(table.header, "th")}</tr></thead><tbody>${table.body
    .map((line) => `<tr>${cells(line, "td")}</tr>`)
    .join("")}</tbody></table>`;
}
