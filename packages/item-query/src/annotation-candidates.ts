import type { AnnotationCandidateLeaf } from "@zotlit/db/item-query";

import type { QueryAnnotation } from "./annotation-fields";
import { equality, lowerItemCandidate } from "./candidate-plan";
import type { CandidateSources } from "./candidate-plan";
import type { FilterNode } from "./filter-plan";
import { lowerIndexedKeySelection } from "./indexed-key-selection";

export function lowerAnnotationCandidate(
  node: FilterNode<QueryAnnotation>,
  sources: CandidateSources,
): AnnotationCandidateLeaf | null {
  const keys = lowerIndexedKeySelection(node, "annotations", sources.library);
  if (keys) return { kind: "keys", ...keys };
  const ownKey = equality(node, (name) => name === "key");
  if (ownKey) return { kind: "keys", target: "self", keys: [ownKey.value] };
  const equals = equality(
    node,
    (name) => name === "type" || name === "color" || name === "colorName",
  );
  if (equals)
    return {
      kind: equals.name === "type" ? "type" : "color",
      value: equals.value,
    };
  if (
    node.kind === "method" &&
    node.name === "contains" &&
    node.subject.kind === "field" &&
    node.subject.name === "tags" &&
    node.args[0]?.kind === "literal" &&
    typeof node.args[0].value === "string"
  ) {
    return { kind: "tag", value: node.args[0].value };
  }
  const parentField = (
    field: FilterNode<QueryAnnotation>,
  ): FilterNode<QueryAnnotation> =>
    field.kind === "field" && field.name.startsWith("item.")
      ? { ...field, name: field.name.slice(5) }
      : field;
  const parent =
    node.kind === "binary"
      ? {
          ...node,
          left: parentField(node.left),
          right: parentField(node.right),
        }
      : node.kind === "method"
        ? { ...node, subject: parentField(node.subject) }
        : node;
  // Only prefixed parent fields enter the Item lowering rules.
  if (
    parent === node ||
    (node.kind === "binary" &&
      ![node.left, node.right].some(
        (field) => field.kind === "field" && field.name.startsWith("item."),
      )) ||
    (node.kind === "method" &&
      !(node.subject.kind === "field" && node.subject.name.startsWith("item.")))
  )
    return null;
  const leaf = lowerItemCandidate(parent, sources);
  return leaf ? { kind: "parent", leaf } : null;
}
