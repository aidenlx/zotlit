// The rows of a Query View as a table of text: one column for each visible
// property, in the view's order. "Copy to clipboard" and "Export CSV..." write
// this table.
import type {
  QueryViewRow,
  QueryViewValue,
} from "@/services/item-query/query-view";

export interface ResultTable {
  readonly header: readonly string[];
  readonly body: readonly (readonly string[])[];
}

/** One value as the text of one cell. */
export function cell(value: QueryViewValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value
      .map((entry: QueryViewValue) => cell(entry))
      .filter((text) => text !== "")
      .join(", ");
  return JSON.stringify(value);
}

/** The table of `rows`, in their order, with the columns `order` names. */
export function resultTable(
  rows: readonly QueryViewRow[],
  order: readonly string[],
): ResultTable {
  return {
    header: [...order],
    body: rows.map((row) =>
      order.map((property) => cell(row.values[property])),
    ),
  };
}

function toText(table: ResultTable, separator: string): string {
  const quote = (text: string) =>
    /["\n\r]/.test(text) || text.includes(separator)
      ? `"${text.replaceAll('"', '""')}"`
      : text;
  return [table.header, ...table.body]
    .map((line) => line.map(quote).join(separator))
    .join("\n");
}

/** The table as CSV, the header first. */
export function toCSV(table: ResultTable): string {
  return toText(table, ",");
}

/** The table as tab-separated text, which a spreadsheet takes on paste. */
export function toTSV(table: ResultTable): string {
  return toText(table, "\t");
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
