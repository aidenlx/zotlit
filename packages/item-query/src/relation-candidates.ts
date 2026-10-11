import { Effect } from "effect";

import type {
  ItemQueryDatabase,
  ItemQueryReaderError,
} from "@zotlit/db/item-query";
import { SCAN_PAGE_SIZE } from "@zotlit/db/item-query";

import { planCandidates, readCandidatePlan } from "./candidate-plan";
import type {
  CandidateFallback,
  CandidatePlan,
  CandidateSources,
} from "./candidate-plan";
import type {
  CandidatePageReader,
  CandidateRelation,
  CandidateDataset,
} from "./dataset";
import type { FilterNode } from "./filter-plan";
import type { QuerySources } from "./query-sources";
import type { TargetLibrary } from "./request";

type CandidateSetReader = (
  page: Parameters<CandidatePageReader>[0],
) => Effect.Effect<
  number[] | CandidateFallback,
  ItemQueryReaderError,
  ItemQueryDatabase
>;

type Node = FilterNode<never>;

/** Plan with the sources shared by every loader of this query. */
export function planDatasetCandidates(
  node: Node,
  sources: Pick<QuerySources, "candidateContext">,
  {
    dataset,
    library,
    relationPageBudget,
  }: {
    readonly dataset: CandidateDataset;
    readonly library: TargetLibrary;
    readonly relationPageBudget: number;
  },
) {
  return planRelatedCandidates(node, sources.candidateContext(library), {
    dataset,
    relationPageBudget,
  });
}

/** Keep the dataset's leaf rules single, including inside a Relation List. */
function planRelatedCandidates(
  node: Node,
  sources: CandidateSources,
  {
    dataset,
    parents = [],
    relationPageBudget,
  }: {
    readonly relationPageBudget: number;
    readonly dataset: CandidateDataset;
    readonly parents?: readonly CandidateRelation["readParents"][];
  },
): CandidatePlan<CandidateSetReader> | null {
  const plan = planCandidates(
    node,
    sources,
    (node, sources): CandidatePlan<CandidateSetReader> | null => {
      const selection = relationSelection(node, dataset);
      if (selection) {
        const { relation, expression } = selection;
        const element = relation.dataset();
        return planRelatedCandidates(
          elementPredicate(expression, element),
          sources,
          {
            dataset: element,
            parents: [relation.readParents, ...parents],
            relationPageBudget,
          },
        );
      }
      for (const parent of dataset.candidateParents) {
        const expression = parent.candidateLeaf(node);
        const relation = dataset.candidateRelations[parent.name];
        if (expression && relation && "readChildren" in relation) {
          const leaf = relation.dataset().lowerCandidate(expression, sources);
          if (leaf === null) return null;
          return {
            kind: "leaf",
            leaf: Effect.fnUntraced(function* ({ libraryID, limit }) {
              const budget = relationPageBudget * SCAN_PAGE_SIZE;
              const result = yield* relation.readChildren({
                libraryID,
                leaf,
                budget,
                limit: parents.length ? budget + 1 : limit,
              });
              if (
                result.exhausted &&
                (parents.length || result.itemIDs.length < limit)
              )
                return "parent-page-budget-exhausted";
              if (!parents.length) return result.itemIDs;
              return yield* ancestorCandidates(result.itemIDs, parents, {
                libraryID,
                limit,
              });
            }),
          };
        }
      }
      const leaf = dataset.lowerCandidate(node, sources);
      const read: CandidatePageReader | null =
        leaf === null
          ? null
          : (page) => dataset.readCandidate({ ...page, leaf });
      return read
        ? {
            kind: "leaf",
            leaf: parents.length
              ? parentCandidates(read, parents, relationPageBudget)
              : read,
          }
        : null;
    },
  );
  return plan && flattenPlan(plan);
}

function flattenPlan(
  plan: CandidatePlan<CandidatePlan<CandidateSetReader>>,
): CandidatePlan<CandidateSetReader> {
  return plan.kind === "leaf"
    ? plan.leaf
    : { ...plan, plans: plan.plans.map(flattenPlan) };
}

export const readDatasetCandidates = (
  plan: CandidatePlan<CandidateSetReader>,
  libraryID: number,
  cap: number,
) =>
  readCandidatePlan(plan, {
    libraryID,
    cap,
    readLeaf: ({ leaf, ...options }) => leaf(options),
  });

/**
 * Page each leaf and retain only distinct ancestors up to the root's cap.
 * Intersecting ancestor supersets can admit different matching children;
 * the evaluator still checks the complete predicate on each parent.
 */
function parentCandidates(
  read: CandidatePageReader,
  parents: readonly CandidateRelation["readParents"][],
  pageBudget: number,
): CandidateSetReader {
  return Effect.fnUntraced(function* ({ libraryID, limit }) {
    const candidates = new Set<number>();
    let afterItemID = 0;
    for (let page = 0; page < pageBudget; page++) {
      const elements = yield* read({
        libraryID,
        limit: SCAN_PAGE_SIZE + 1,
        afterItemID,
      });
      const ids = yield* ancestorCandidates(
        elements.slice(0, SCAN_PAGE_SIZE),
        parents,
        { libraryID, limit },
      );
      for (const id of ids) {
        candidates.add(id);
        if (candidates.size >= limit) return [...candidates];
      }
      if (elements.length <= SCAN_PAGE_SIZE) return [...candidates];
      afterItemID = elements[SCAN_PAGE_SIZE - 1]!;
    }
    return "relation-page-budget-exhausted";
  });
}

const ancestorCandidates = Effect.fnUntraced(function* (
  elements: readonly number[],
  parents: readonly CandidateRelation["readParents"][],
  { libraryID, limit }: { libraryID: number; limit: number },
) {
  const candidates = new Set<number>();
  for (let start = 0; start < elements.length; start += SCAN_PAGE_SIZE) {
    let ids = elements.slice(start, start + SCAN_PAGE_SIZE);
    for (const readParents of parents)
      ids = yield* readParents({ libraryID, itemIDs: ids });
    for (const id of ids) {
      candidates.add(id);
      if (candidates.size >= limit) return [...candidates];
    }
  }
  return [...candidates];
});

function relationSelection(node: Node, dataset: CandidateDataset) {
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
  const relation = dataset.candidateRelations[filtered.subject.name];
  return relation && "readParents" in relation
    ? { relation, expression: filtered.expression }
    : null;
}

/** Rebind this lambda's value paths for planning; keep nested bindings local. */
function elementPredicate(node: Node, dataset: CandidateDataset): Node {
  const path = valuePath(node);
  const field = path === null ? undefined : dataset.filterField(path);
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
