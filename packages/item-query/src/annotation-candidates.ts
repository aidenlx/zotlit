import type { AnnotationCandidateLeaf } from "@zotlit/db/item-query";

import { ANNOTATION_PARENTS } from "./annotation-fields";
import { equality, lowerItemCandidate } from "./candidate-plan";
import type { CandidateSources } from "./candidate-plan";
import type { FilterNode } from "./filter-plan";
import { lowerIndexedKeySelection } from "./indexed-key-selection";
import { parentCandidateLeaf } from "./parent-records";

export function lowerAnnotationCandidate<Item>(
  node: FilterNode<Item>,
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
  const parent = parentCandidateLeaf(node, ANNOTATION_PARENTS, "items");
  if (!parent) return null;
  const leaf = lowerItemCandidate(parent, sources);
  return leaf ? { kind: "parent", leaf } : null;
}
