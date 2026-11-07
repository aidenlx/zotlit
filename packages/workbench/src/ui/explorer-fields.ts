import type {
  DisplayNode,
  SnippetKind,
  TemplateEngine,
} from "#/explorer/index";

import { COMMON_FIELDS } from "./completion-fields";
// Common field labels and values shared by the Explorer and its hosts.
import type { WorkbenchMessages } from "./generated/messages";
import type { TemplateRoot } from "./model";

import {
  formatAccessorPath,
  loopVariable,
  renderSnippet,
  snippetKindsFor,
} from "#/explorer/index";
import { listLineProperty } from "#/explorer/list-items";
import { coerceToString } from "#/explorer/string-coercion";

export interface FieldRow {
  readonly node: DisplayNode;
  readonly label: string;
  readonly value: string;
}

/**
 * The common rows for `root` in their fixed order, over display nodes built
 * from that root. A row the paper has no key for is dropped rather than shown
 * empty.
 */
export function commonRows(
  m: WorkbenchMessages,
  root: TemplateRoot,
  nodes: readonly DisplayNode[],
): FieldRow[] {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  return COMMON_FIELDS[root].flatMap((field) => {
    const node = byKey.get(field.key);
    return node
      ? [{ node, label: m[field.label](), value: fieldValueText(node) }]
      : [];
  });
}

/** Matches a row on the name the reader sees, on its raw key, and on this paper's value. */
export function rowMatches(row: FieldRow, query: string): boolean {
  const needle = query.toLowerCase();
  return (
    row.label.toLowerCase().includes(needle) ||
    row.node.label.toLowerCase().includes(needle) ||
    row.value.toLowerCase().includes(needle)
  );
}

/** This paper's value for one row, as the single line a row shows. */
export function fieldValueText(node: DisplayNode): string {
  if (node.kind === "placeholder") return node.reason;
  if (node.kind === "helper") return node.evaluated ?? "";
  if (node.kind === "list-property") return node.preview;
  switch (node.valueType) {
    case "array":
    case "object":
      return node.preview ?? "";
    case "getter":
    case "null":
    case "undefined":
      return "";
    default:
      return String(node.value);
  }
}

export type FieldInsertionMode = "template" | "expression" | "json-e";

export function fieldSnippet(
  node: DisplayNode,
  mode: FieldInsertionMode,
  {
    kind,
    engine = "liquid",
  }: { kind?: SnippetKind; engine?: TemplateEngine } = {},
): string {
  if (mode === "template")
    return renderSnippet(node, engine, kind ?? snippetKindsFor(node)[0]!);
  if (node.kind === "list-property") {
    // A frontmatter value takes the property of every item as a list.
    const list = formatAccessorPath(node.list, "zt");
    if (mode === "expression")
      return `${list} | map: ${JSON.stringify(node.property)}`;
    const item = loopVariable(node.list);
    return JSON.stringify({
      $map: { $eval: list },
      [`each(${item})`]: { $eval: formatAccessorPath([node.property], item) },
    });
  }
  const path = formatAccessorPath(node.path, "zt");
  return mode === "expression" ? path : JSON.stringify({ $eval: path });
}

/**
 * What the field's snippet of `kind` writes into the note for this item: a
 * list in one line or one Markdown list line per item. `null` where the item
 * has no value, so the note gets nothing. It reads the item's values and does
 * not render the template.
 */
export function fieldResult(
  node: DisplayNode,
  kind: SnippetKind = snippetKindsFor(node)[0]!,
): string | null {
  const items = listItemsText(node);
  const text =
    items === null
      ? singleText(node)
      : kind === "loop"
        ? items.map((item) => `- ${item}`).join("\n")
        : items.join(", ");
  return text === "" ? null : text;
}

/** Each item of a list, or of a list property, as one line shows it; `null` for any other node. */
function listItemsText(node: DisplayNode): readonly string[] | null {
  if (node.kind === "list-property") return node.values;
  if (node.kind !== "value" || !Array.isArray(node.value)) return null;
  const list: readonly unknown[] = node.value;
  const property = listLineProperty(list);
  return list
    .map((item) =>
      property === undefined
        ? item
        : (item as Record<string, unknown> | null)?.[property],
    )
    .filter((item) => item !== null && item !== undefined)
    .map(coerceToString);
}

function singleText(node: DisplayNode): string {
  if (node.kind === "placeholder") return node.reason;
  if (node.kind === "helper") return node.evaluated ?? "";
  if (node.kind === "list-property") return node.values.join(", ");
  switch (node.valueType) {
    case "getter":
    case "null":
    case "undefined":
      return "";
    default: {
      const text = coerceToString(node.value);
      return node.path.at(-1) === "backlink" && text !== ""
        ? `[Zotero](${text})`
        : text;
    }
  }
}
