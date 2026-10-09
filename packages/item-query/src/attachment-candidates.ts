import type { AttachmentCandidateLeaf } from "@zotlit/db/item-query";

import type { QueryAttachment } from "./attachment-fields";
import { equality, lowerItemCandidate } from "./candidate-plan";
import type { CandidateSources } from "./candidate-plan";
import type { FilterNode } from "./filter-plan";
import { lowerIndexedKeySelection } from "./indexed-key-selection";

export function lowerAttachmentCandidate(
  node: FilterNode<QueryAttachment>,
  sources: CandidateSources,
): AttachmentCandidateLeaf | null {
  const selection = lowerIndexedKeySelection(
    node,
    "attachments",
    sources.library,
  );
  if (selection?.target === "self")
    return { kind: "keys", keys: selection.keys };
  if (selection?.target === "item")
    return { kind: "parent", leaf: { kind: "keys", keys: selection.keys } };
  const equals = equality(
    node,
    (name) => name === "key" || name === "contentType" || name === "linkMode",
  );
  if (equals)
    return {
      kind: equals.name as "key" | "contentType" | "linkMode",
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
    field: FilterNode<QueryAttachment>,
  ): FilterNode<QueryAttachment> =>
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
