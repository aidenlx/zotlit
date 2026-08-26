// Renders the shared page model as GFM for the page's Markdown edition.
//
// The interactive table hides the full type, helper usage, and examples
// behind a row expander; Markdown has no expander, so every detail this
// module renders lands directly in the row.

import { sectionOf } from "./page-model";
import type {
  Doc,
  ItemTypeRow,
  PageModel,
  RowModel,
  TableModel,
} from "./page-model";

/** One section's tables as GFM, replacing `<ContractTable section>` in the Markdown edition. */
export function renderContractTableMarkdown(
  model: PageModel,
  section: string,
): string {
  const page = sectionOf(model, section);
  if (page.itemTypes.length > 0) {
    return renderItemTypeTable(page.itemTypes);
  }
  return page.tables.map(renderTable).join("\n\n");
}

function renderItemTypeTable(rows: readonly ItemTypeRow[]): string {
  const lines = [
    "| Item type | Fields |",
    "| --- | --- |",
    ...rows.map(
      ({ itemType, fields }) =>
        `| \`${itemType}\` | ${fields.map((field) => `\`${field}\``).join(", ")} |`,
    ),
  ];
  return lines.join("\n");
}

function renderTable(table: TableModel): string {
  const blocks = [
    table.caption && `**${table.caption}**`,
    ...renderDocMarkdown(table.description),
    [
      "| Property | Type | Description |",
      "| --- | --- | --- |",
      ...table.rows.map((row) => renderRow(table, row)),
    ].join("\n"),
  ];
  return blocks.filter((block) => block !== undefined).join("\n\n");
}

function renderRow(table: TableModel, row: RowModel): string {
  const property = cell(
    `\`${(table.prefix ?? "") + row.name}${row.optional ? "?" : ""}\``,
  );
  const type = cell(
    row.typeHref
      ? `[\`${row.fullType}\`](${row.typeHref})`
      : `\`${row.fullType}\``,
  );
  const description = cell(
    [renderDocMarkdown(row.description).join(" "), ...detailNotes(row)]
      .filter((part) => part.length > 0)
      .join(" "),
  );
  return `| ${property} | ${type} | ${description} |`;
}

/** The notes a row's expander shows in the React table, restated inline for Markdown. */
function detailNotes(row: RowModel): string[] {
  const notes: string[] = [];
  if (row.helper) {
    notes.push(
      `Signature: \`${row.helper.signature}\`.`,
      `Liquid: \`${row.helper.liquid}\`.`,
      `Eta: \`${row.helper.eta}\`.`,
    );
    if (row.helper.filter)
      notes.push(`Liquid filter: \`${row.helper.filter}\`.`);
  }
  if (row.examples.length > 0) {
    const label = row.examples.length > 1 ? "Examples" : "Example";
    const codes = row.examples.map((example) => `\`${example.code}\``);
    notes.push(`${label}: ${codes.join(", ")}.`);
  }
  return notes;
}

/** A GFM cell cannot carry a raw `|` or a newline, both of which union types and Liquid filters use. */
function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll(/\s+/g, " ").trim();
}

/** One Markdown paragraph per normalized paragraph; `onText` guards each prose run. */
export function renderDocMarkdown(
  doc: Doc,
  onText?: (text: string) => string,
): string[] {
  return doc.map((paragraph) =>
    paragraph
      .map((node) => {
        switch (node.kind) {
          case "text":
            return onText ? onText(node.value) : node.value;
          case "code":
            return `\`${node.value}\``;
          case "link":
            return `[${node.code ? `\`${node.text}\`` : node.text}](${node.href})`;
        }
      })
      .join(""),
  );
}
