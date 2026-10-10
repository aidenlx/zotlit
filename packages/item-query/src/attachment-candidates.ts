import type { AttachmentCandidateLeaf } from "@zotlit/db/item-query";

import { ATTACHMENT_PARENTS } from "./attachment-fields";
import { equality, lowerItemCandidate } from "./candidate-plan";
import type { CandidateSources } from "./candidate-plan";
import type { FilterNode } from "./filter-plan";
import { lowerIndexedKeySelection } from "./indexed-key-selection";
import { parentCandidateLeaf } from "./parent-records";

export function lowerAttachmentCandidate<Item>(
  node: FilterNode<Item>,
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
    (name) =>
      name === "key" ||
      name === "contentType" ||
      name === "linkMode" ||
      name === "fileType",
  );
  if (equals)
    return {
      kind: equals.name as "key" | "contentType" | "linkMode" | "fileType",
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
  const parent = parentCandidateLeaf(node, ATTACHMENT_PARENTS, "items");
  if (!parent) return null;
  const leaf = lowerItemCandidate(parent, sources);
  return leaf ? { kind: "parent", leaf } : null;
}
