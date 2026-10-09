import { Effect } from "effect";

import {
  readAnnotationCandidateSet,
  readAttachmentCandidateSet,
  readCandidateSet,
  readRelationCandidateSet,
  SCAN_PAGE_SIZE,
} from "@zotlit/db/item-query";
import type {
  CandidateRelation,
  ItemQueryDatabase,
  ItemQueryReaderError,
} from "@zotlit/db/item-query";

import { lowerAnnotationCandidate } from "./annotation-candidates";
import { annotationFilterRegistry } from "./annotation-fields";
import { lowerAttachmentCandidate } from "./attachment-candidates";
import { attachmentFilterRegistry } from "./attachment-fields";
import {
  lowerItemCandidate,
  planCandidates,
  readCandidatePlan,
} from "./candidate-plan";
import type { CandidatePlan, CandidateSources } from "./candidate-plan";
import type { QueryDataset } from "./dataset";
import type { FilterNode } from "./filter-plan";

/** A candidate reader selected by the dataset's existing leaf lowering. */
type CandidateReader = (options: {
  libraryID: number;
  limit: number;
}) => Effect.Effect<number[], ItemQueryReaderError, ItemQueryDatabase>;
type Node = FilterNode<never>;

/** Keep the dataset's leaf rules single, including inside a Relation List. */
export function planDatasetCandidates(
  node: Node,
  sources: CandidateSources,
  dataset: QueryDataset["id"],
): CandidatePlan<CandidateReader> | null {
  return planCandidates(
    node,
    sources,
    (node, sources): CandidateReader | null => {
      const relation = lowerRelation(node, sources, dataset);
      if (relation) return relation;
      if (dataset === "attachments") {
        const leaf = lowerAttachmentCandidate(node, sources);
        return leaf
          ? (options) => readAttachmentCandidateSet({ ...options, leaf })
          : null;
      }
      if (dataset === "annotations") {
        const leaf = lowerAnnotationCandidate(node, sources);
        return leaf
          ? (options) => readAnnotationCandidateSet({ ...options, leaf })
          : null;
      }
      const leaf = lowerItemCandidate(node, sources);
      return leaf ? (options) => readCandidateSet({ ...options, leaf }) : null;
    },
  );
}

export const readDatasetCandidates = (
  plan: CandidatePlan<CandidateReader>,
  libraryID: number,
  cap: number,
) =>
  readCandidatePlan(plan, {
    libraryID,
    cap,
    readLeaf: ({ leaf, ...options }) => leaf(options),
  });

function lowerRelation(
  node: Node,
  sources: CandidateSources,
  dataset: QueryDataset["id"],
): CandidateReader | null {
  let filtered: Node | null = null;
  if (
    node.kind === "binary" &&
    node.right.kind === "literal" &&
    ((node.operator === ">" && node.right.value === 0) ||
      (node.operator === ">=" && node.right.value === 1)) &&
    node.left.kind === "property" &&
    node.left.name === "length"
  )
    filtered = node.left.subject;
  if (
    node.kind === "unary" &&
    node.operator === "!" &&
    node.operand.kind === "method" &&
    node.operand.name === "isEmpty" &&
    !node.operand.args.length
  )
    filtered = node.operand.subject;
  if (
    filtered?.kind !== "element" ||
    filtered.name !== "filter" ||
    filtered.subject.kind !== "field"
  )
    return null;
  const name = filtered.subject.name;
  const relation: CandidateRelation | null =
    dataset === "items" && name === "attachments"
      ? "item-attachments"
      : dataset === "items" && name === "annotations"
        ? "item-annotations"
        : dataset === "attachments" && name === "annotations"
          ? "attachment-annotations"
          : null;
  if (!relation) return null;
  const elementDataset =
    relation === "item-attachments" ? "attachments" : "annotations";
  const plan = planDatasetCandidates(
    elementPredicate(filtered.expression, elementDataset),
    sources,
    elementDataset,
  );
  if (!plan) return null;
  return Effect.fnUntraced(function* ({ libraryID, limit }) {
    // A large element set can have one parent. Apply the cap only AFTER the
    // element plan's intersections/unions and the parent join.
    const elements = yield* readDatasetCandidates(
      plan,
      libraryID,
      Number.MAX_SAFE_INTEGER - 1,
    );
    if (!elements)
      return yield* Effect.die(
        new RangeError(
          "The relation element candidate set exceeds the safe ID count.",
        ),
      );
    const ids = [...elements];
    const parents = new Set<number>();
    for (let start = 0; start < ids.length; start += SCAN_PAGE_SIZE) {
      const chunk = yield* readRelationCandidateSet({
        relation,
        libraryID,
        itemIDs: ids.slice(start, start + SCAN_PAGE_SIZE),
      });
      for (const id of chunk) {
        parents.add(id);
        if (parents.size >= limit) return [...parents];
      }
    }
    return [...parents];
  });
}

/** Rebind this lambda's value paths for planning; keep nested bindings local. */
function elementPredicate(
  node: Node,
  dataset: "attachments" | "annotations",
): Node {
  const registry =
    dataset === "attachments"
      ? attachmentFilterRegistry
      : annotationFilterRegistry;
  const path = valuePath(node);
  const field = path === null ? undefined : registry.field(path);
  if (field?.filterable)
    return { ...node, kind: "field", name: path!, value: field.value };
  const visit = (node: Node) => elementPredicate(node, dataset);
  switch (node.kind) {
    // Bare fields belong to the outer row, never to the element dataset.
    case "field":
    case "custom-field":
      return { ...node, kind: "binding", name: "outer" };
    case "binary":
      return { ...node, left: visit(node.left), right: visit(node.right) };
    case "unary":
      return { ...node, operand: visit(node.operand) };
    case "method":
      return {
        ...node,
        subject: visit(node.subject),
        args: node.args.map(visit),
      };
    case "element":
      return {
        ...node,
        subject: visit(node.subject),
        args: node.args.map(visit),
      };
    case "property":
      return { ...node, subject: visit(node.subject) };
    case "index":
      return {
        ...node,
        subject: visit(node.subject),
        index: visit(node.index),
      };
    case "list":
      return { ...node, elements: node.elements.map(visit) };
    default:
      return node;
  }
}

function valuePath(node: Node): string | null {
  if (node.kind === "binding" && node.name === "value") return "";
  if (node.kind !== "property") return null;
  const parent = valuePath(node.subject);
  return parent === null ? null : parent ? `${parent}.${node.name}` : node.name;
}
