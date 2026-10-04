// The planner: the candidate sets that a validated Filter Expression gives.
// A candidate set holds every Item that can match and may hold more; the
// evaluator decides each match.
import { Effect } from "effect";

import { readCandidateSet } from "@zotlit/db/item-query";
import type {
  CandidateLeaf,
  CollectionPaths,
  FieldVocabulary,
  ItemQueryDatabase,
  ItemQueryReaderError,
} from "@zotlit/db/item-query";

import { isStoredStringField } from "./fields";
import type { FilterNode } from "./filter-plan";

/** How the engine gets a candidate set for a filter. */
export type CandidatePlan =
  | { readonly kind: "leaf"; readonly leaf: CandidateLeaf }
  /** `&&`: the intersection of the sets within the cap; one set is enough. */
  | { readonly kind: "all"; readonly plans: readonly CandidatePlan[] }
  /** `||`: the union of the sets; it needs every set. */
  | { readonly kind: "any"; readonly plans: readonly CandidatePlan[] };

/**
 * What the query read from the source before planning. A leaf that needs a
 * source the query did not read lowers nothing.
 */
export interface CandidateSources {
  readonly vocabulary: FieldVocabulary | null;
  readonly collectionPaths: CollectionPaths | undefined;
}

/**
 * A lowering turns one node into the leaf of a candidate reader, or gives
 * null for a node of another form. Every Item for which the node is truthy
 * must be in the candidate set of the leaf.
 */
type Lowering = (
  node: FilterNode,
  sources: CandidateSources,
) => CandidateLeaf | null;

const stringLiteral = (node: FilterNode | undefined): string | null =>
  node?.kind === "literal" && typeof node.value === "string"
    ? node.value
    : null;

/** `tags.contains("x")` */
const lowerTagContains: Lowering = (node) => {
  if (node.kind !== "method" || node.name !== "contains") return null;
  if (node.subject.kind !== "field" || node.subject.name !== "tags") {
    return null;
  }
  const name = node.args.length === 1 ? stringLiteral(node.args[0]) : null;
  return name === null ? null : { kind: "tag", name };
};

/** The field and the literal of `field == literal`, in either operand order. */
function equality(
  node: FilterNode,
  accepts: (name: string) => boolean,
): { name: string; value: string } | null {
  if (node.kind !== "binary" || node.operator !== "==") return null;
  for (const [field, literal] of [
    [node.left, node.right],
    [node.right, node.left],
  ] as const) {
    if (field.kind !== "field" || !accepts(field.name)) continue;
    const value = stringLiteral(literal);
    if (value !== null) return { name: field.name, value };
  }
  return null;
}

/** `key == "x"`, in either operand order. */
const lowerKeyEquals: Lowering = (node) => {
  const match = equality(node, (name) => name === "key");
  return match && { kind: "key", key: match.value };
};

/**
 * `field == "x"` on a built-in field whose filter value is its stored string,
 * in either operand order. The set covers every field ID of the field's
 * aliases.
 */
const lowerFieldEquals: Lowering = (node, { vocabulary }) => {
  const match = vocabulary && equality(node, isStoredStringField);
  return (
    match && {
      kind: "field",
      fieldIDs: vocabulary.fieldIDsOf(match.name),
      value: match.value,
    }
  );
};

/**
 * `collections.contains(path)` and `collections.within(path)`: the live
 * Collections whose root-first path, joined by `/`, is `path`, and for
 * `within` every Collection below them.
 */
const lowerCollections: Lowering = (node, { collectionPaths }) => {
  if (node.kind !== "method" || !collectionPaths) return null;
  if (node.name !== "contains" && node.name !== "within") return null;
  if (node.subject.kind !== "field" || node.subject.name !== "collections") {
    return null;
  }
  const path = node.args.length === 1 ? stringLiteral(node.args[0]) : null;
  if (path === null) return null;
  const subtree = node.name === "within";
  const collectionIDs: number[] = [];
  for (const [collectionID, names] of collectionPaths) {
    const joined = names.join("/");
    if (joined === path || (subtree && joined.startsWith(`${path}/`))) {
      collectionIDs.push(collectionID);
    }
  }
  return { kind: "collection", collectionIDs };
};

/** The lowered leaves. Add a leaf form here, with its reader in `@zotlit/db`. */
const LOWERINGS: readonly Lowering[] = [
  lowerTagContains,
  lowerKeyEquals,
  lowerFieldEquals,
  lowerCollections,
];

/**
 * Plan the candidate sets of a filter. Null: no part of the filter gives a
 * set, and the query uses the scan. `&&` uses the sides that lower, `||`
 * needs both sides, and `!` and every other expression lower nothing.
 */
export function planCandidates(
  node: FilterNode,
  sources: CandidateSources,
): CandidatePlan | null {
  if (node.kind === "binary" && node.operator === "&&") {
    const plans = [node.left, node.right]
      .map((side) => planCandidates(side, sources))
      .filter((plan) => plan !== null);
    if (plans.length === 0) return null;
    return plans.length === 1 ? plans[0]! : { kind: "all", plans };
  }
  if (node.kind === "binary" && node.operator === "||") {
    const left = planCandidates(node.left, sources);
    const right = planCandidates(node.right, sources);
    return left && right ? { kind: "any", plans: [left, right] } : null;
  }
  for (const lower of LOWERINGS) {
    const leaf = lower(node, sources);
    if (leaf) return { kind: "leaf", leaf };
  }
  return null;
}

/**
 * Read the candidate set of a plan: Item IDs of the Target Library, not yet
 * restricted to the query universe. Null: the set is above `cap`, and the
 * query uses the scan. Each statement reads `cap + 1` IDs at most.
 */
export function readCandidates(
  plan: CandidatePlan,
  libraryID: number,
  cap: number,
): Effect.Effect<
  ReadonlySet<number> | null,
  ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    if (plan.kind === "leaf") {
      const itemIDs = yield* readCandidateSet({
        libraryID,
        leaf: plan.leaf,
        limit: cap + 1,
      });
      return itemIDs.length > cap ? null : new Set(itemIDs);
    }
    if (plan.kind === "any") {
      const union = new Set<number>();
      for (const branch of plan.plans) {
        const set = yield* readCandidates(branch, libraryID, cap);
        if (!set) return null;
        for (const itemID of set) union.add(itemID);
        if (union.size > cap) return null;
      }
      return union;
    }
    const sets: ReadonlySet<number>[] = [];
    for (const branch of plan.plans) {
      const set = yield* readCandidates(branch, libraryID, cap);
      if (set) sets.push(set);
    }
    if (sets.length === 0) return null;
    return sets.reduce(
      (kept, set) => new Set([...kept].filter((itemID) => set.has(itemID))),
    );
  });
}
