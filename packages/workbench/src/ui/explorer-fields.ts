import type { DisplayNode } from "#/explorer/index";

import { COMMON_FIELDS } from "./completion-fields";
// Common field labels and values shared by the Explorer and its hosts.
import type { WorkbenchMessages } from "./generated/messages";
import type { TemplateRoot } from "./model";

import { fieldMatches, outputText } from "#/explorer/index";

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

/** Matches a row by the field tree's one search rule, on this paper's value as the row shows it. */
export function rowMatches(row: FieldRow, query: string): boolean {
  return fieldMatches(query, {
    label: row.node.label,
    alias: row.label,
    path: row.node.path,
    values: [row.value],
  });
}

/** This paper's value for one row, as the single line a row shows. */
export function fieldValueText(node: DisplayNode): string {
  if (node.kind === "list-property") return node.preview;
  if (
    node.kind === "value" &&
    (node.valueType === "array" || node.valueType === "object")
  )
    return node.preview ?? "";
  return outputText(node);
}
