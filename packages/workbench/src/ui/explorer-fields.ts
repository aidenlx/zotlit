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
  outputText,
  renderSnippet,
  snippetKindsFor,
} from "#/explorer/index";

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
  if (node.kind === "list-property") return node.preview;
  if (
    node.kind === "value" &&
    (node.valueType === "array" || node.valueType === "object")
  )
    return node.preview ?? "";
  return outputText(node);
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
