import type {
  DisplayNode,
  SnippetKind,
  TemplateEngine,
} from "#/explorer/index";

import { COMMON_FIELDS } from "./completion-fields";
// Common field labels and values shared by the Explorer and its hosts.
import type { WorkbenchMessages } from "./generated/messages";
import type { TemplateRoot } from "./store";

import { formatAccessorPath, renderSnippet } from "#/explorer/index";

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
  switch (node.valueType) {
    case "array":
      return (node.value as unknown[]).map(String).join(", ");
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
    kind = "output",
    engine = "liquid",
  }: { kind?: SnippetKind; engine?: TemplateEngine } = {},
): string {
  if (mode === "template") return renderSnippet(node, engine, kind);
  const path = formatAccessorPath(node.path, "zt");
  return mode === "expression" ? path : JSON.stringify({ $eval: path });
}
