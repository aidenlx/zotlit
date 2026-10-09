import { parseIndexedKey } from "@zotlit/db";

import type { QueryDataset } from "./dataset";
import type { Span } from "./fault";
import type { FilterNode } from "./filter-plan";
import type { TargetLibrary } from "./request";

type KeyTarget = "self" | "item" | "attachment";
const KEY_PATHS: Record<
  QueryDataset["id"],
  Readonly<Record<string, KeyTarget>>
> = {
  items: { indexedKey: "self" },
  annotations: {
    indexedKey: "self",
    "item.indexedKey": "item",
    "attachment.indexedKey": "attachment",
  },
};

interface KeyLiteral {
  readonly text: string;
  readonly key: string;
  readonly groupID: number | null;
  readonly at: Span;
}

/** Equality in either order, or a literal list containing one Indexed Key field. */
function selection<Item>(node: FilterNode<Item>, dataset: QueryDataset["id"]) {
  const pairs =
    node.kind === "binary" && node.operator === "=="
      ? ([
          [node.left, [node.right]],
          [node.right, [node.left]],
        ] as const)
      : node.kind === "method" &&
          node.name === "contains" &&
          node.subject.kind === "list" &&
          node.args.length === 1
        ? ([[node.args[0]!, node.subject.elements]] as const)
        : [];
  for (const [field, literals] of pairs) {
    const target =
      field.kind === "field" ? KEY_PATHS[dataset][field.name] : undefined;
    if (target) return { target, literals };
  }
  return null;
}

function keyLiteral<Item>(node: FilterNode<Item>): KeyLiteral | null {
  if (node.kind !== "literal" || typeof node.value !== "string") return null;
  const parsed = parseIndexedKey(node.value);
  if (!parsed || (parsed.groupID !== null && parsed.groupID <= 0)) return null;
  return { ...parsed, text: node.value, at: { from: node.from, to: node.to } };
}

/** Invalid or computed list members leave the complete selection to the scan. */
export function lowerIndexedKeySelection<Item>(
  node: FilterNode<Item>,
  dataset: QueryDataset["id"],
  library: TargetLibrary,
): { target: KeyTarget; keys: readonly string[] } | null {
  const match = selection(node, dataset);
  if (!match) return null;
  const keys: string[] = [];
  for (const literal of match.literals) {
    const parsed = keyLiteral(literal);
    if (!parsed) return null;
    if (parsed.groupID === library.groupID) keys.push(parsed.key);
  }
  return { target: match.target, keys };
}

export interface KeyLibraryWarning {
  readonly kind: "key-library";
  readonly key: string;
  readonly library: string;
  readonly include: string;
  readonly at: Span;
}

const selector = (groupID: number | null) =>
  groupID === null ? "personal" : `group:${groupID}`;

/** Inspect selections in every branch; warnings never change Target Libraries. */
export function indexedKeyWarnings<Item>(
  root: FilterNode<Item>,
  dataset: QueryDataset["id"],
  libraries: readonly TargetLibrary[],
): KeyLibraryWarning[] {
  const warnings: KeyLibraryWarning[] = [];
  const visit = (node: FilterNode<Item>) => {
    for (const literal of selection(node, dataset)?.literals ?? []) {
      const key = keyLiteral(literal);
      if (
        key &&
        !libraries.some((library) => library.groupID === key.groupID)
      ) {
        const library = selector(key.groupID);
        warnings.push({
          kind: "key-library",
          key: key.text,
          library,
          include: [
            ...libraries.map((target) => selector(target.groupID)),
            library,
          ].join(","),
          at: key.at,
        });
      }
    }
    switch (node.kind) {
      case "binary":
        visit(node.left);
        visit(node.right);
        break;
      case "unary":
        visit(node.operand);
        break;
      case "list":
        node.elements.forEach(visit);
        break;
      case "if":
        visit(node.condition);
        visit(node.whenTrue);
        if (node.whenFalse) visit(node.whenFalse);
        break;
      case "element":
        visit(node.expression);
        visit(node.subject);
        node.args.forEach(visit);
        break;
      case "method":
        visit(node.subject);
        node.args.forEach(visit);
        break;
      case "function":
        node.args.forEach(visit);
        break;
      case "property":
        visit(node.subject);
        break;
      case "index":
        visit(node.subject);
        visit(node.index);
        break;
    }
  };
  visit(root);
  return warnings;
}
