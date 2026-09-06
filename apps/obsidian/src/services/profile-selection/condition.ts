// The condition contract of a Profile Selection Rule: which Filter Expressions a rule's filter may carry, how the editor writes one, and how a filter is matched against the facts of a Zotero Item.
//
// A rule stores its conditions as a Rule Filter: an explicit `and` / `or`
// tree whose leaves are Filter Expressions. The shared language parses far
// more than a leaf accepts. This module is the gate: a leaf compiles to a
// `RuleCondition` only when every node belongs to the supported vocabulary,
// and anything else is a `ConditionProblem` — reported when the rule is
// edited and again when it is evaluated, so a rule the vault cannot judge
// never selects a Profile.
//
// Supported vocabulary:
// - `itemType == "<type>"` / `itemType != "<type>"` — the built-in Zotero type.
// - `tags.contains("<name>")`, `containsAny`, `containsAll`, and `isEmpty` —
//   exact, case-sensitive tests over manual and automatic Tag names.
// - `inCollection("<library>", "<key>")` — filed in the Collection or any of
//   its descendants; `inCollectionDirectly(...)` — filed in it itself. The
//   Library is the portable `personal` / `group:<groupID>` reference and the
//   key is Zotero's Collection key, so a reference survives a rename and
//   tells identical names or keys in different Libraries apart.
// - `!`, `&&`, `||`, and grouping inside one leaf; the tree above the leaves
//   is the ordinary way to combine conditions.
//
// Whether a referenced Collection exists is not a compile-time question: the
// evaluator checks `collectionReferences` against the database and reports a
// `missing-collection` problem, keeping a stale reference distinct from an
// ordinary nonmatch.
import { regex } from "arkregex";

import { parseExpressionAst } from "@zotlit/filter-expression";
import type { ExpressionNode } from "@zotlit/filter-expression";
import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

import { selectorKey } from "@/services/library-scope/scope";
import type { LibrarySelector } from "@/services/library-scope/scope";

import type { RuleFilter } from "./schema";

/** The Item field a rule may test. */
export const ITEM_TYPE_FIELD = "itemType";
/** The membership predicates a rule may call. */
export const IN_COLLECTION_FUNCTION = "inCollection";
export const IN_COLLECTION_DIRECTLY_FUNCTION = "inCollectionDirectly";
export const TAGS_FIELD = "tags";

export type ListOperator =
  | "contains"
  | "containsAny"
  | "containsAll"
  | "isEmpty";

/** A portable reference to one Collection: its Library and Zotero key. */
export interface CollectionReference {
  library: LibrarySelector;
  key: string;
}

export type RuleCondition =
  | {
      kind: "group";
      /** `all`: every condition must hold; `any`: at least one must. */
      match: "all" | "any";
      conditions: RuleCondition[];
    }
  | {
      kind: "item-type";
      operator: "is";
      negated: boolean;
      values: [string];
    }
  | {
      kind: "collection";
      negated: boolean;
      library: LibrarySelector;
      key: string;
      /** Whether descendants of the Collection count as membership. */
      descendants: boolean;
    }
  | {
      kind: "tags";
      operator: ListOperator;
      negated: boolean;
      values: string[];
    };

/** A condition the editor shows as one row. */
export type FlatCondition = Exclude<RuleCondition, { kind: "group" }>;

/** One reason an expression is outside the supported contract. */
export type ConditionProblem =
  | {
      code:
        | "empty"
        | "syntax"
        | "unsupported"
        | "unknown-item-type"
        | "unknown-library";
      /** Source range of the offending node, for the editor to point at. */
      from: number;
      to: number;
      /** The offending source text (empty for a missing token). */
      text: string;
    }
  | {
      /** A referenced Collection the database does not hold. */
      code: "missing-collection";
      library: LibrarySelector;
      key: string;
    };

export type CompiledCondition =
  | { condition: RuleCondition; problem: null }
  | { condition: null; problem: ConditionProblem };

/** The Item facts a condition reads. */
export interface RuleItemFacts {
  /** `null` for a group Library Zotero reports no group ID for. */
  library: LibrarySelector | null;
  itemType: string;
  /** Every Tag name applied to the Item, manual and automatic alike. */
  tags: readonly string[];
  /** Keys of the Collections the Item is filed in directly. */
  collections: readonly string[];
  /** Keys of every live ancestor of those Collections. */
  collectionAncestors: readonly string[];
}

const KNOWN_ITEM_TYPES = new Set(ITEM_TYPES.map(({ name }) => name));

/** The expression of an empty "Match all" group: it holds for every Item. */
const MATCH_ALL_EXPRESSION = "true";

/**
 * Validate a Rule Filter against the supported contract: every leaf compiles,
 * and each group becomes a "Match all" / "Match any" group in tree order.
 * The first problem found, in reading order, is the filter's problem.
 */
export function compileFilter(filter: RuleFilter): CompiledCondition {
  if (typeof filter === "string") return compileCondition(filter);
  const match = "and" in filter ? "all" : "any";
  const entries = "and" in filter ? filter.and : filter.or;
  const conditions: RuleCondition[] = [];
  for (const entry of entries) {
    const compiled = compileFilter(entry);
    if (compiled.problem) return compiled;
    conditions.push(compiled.condition);
  }
  return { condition: { kind: "group", match, conditions }, problem: null };
}

/**
 * Validate one Filter Expression against the supported contract.
 *
 * A blank expression is a problem, since a leaf has to test something;
 * `true` is the empty "Match all" group, which is how {@link formatCondition}
 * writes it.
 */
export function compileCondition(expression: string): CompiledCondition {
  const source = expression.trim();
  if (source === "")
    return {
      condition: null,
      problem: { code: "empty", from: 0, to: 0, text: "" },
    };
  const parsed = parseExpressionAst(source);
  if (parsed.error) {
    const { from, to } = parsed.error;
    return {
      condition: null,
      problem: { code: "syntax", from, to, text: source.slice(from, to) },
    };
  }
  try {
    return { condition: convert(parsed.ast), problem: null };
  } catch (error) {
    if (error instanceof UnsupportedNode) {
      const { code, from, to } = error;
      return {
        condition: null,
        problem: { code, from, to, text: source.slice(from, to) },
      };
    }
    throw error;
  }
}

/** Whether `condition` holds for an Item with `facts`. */
export function matchCondition(
  condition: RuleCondition,
  facts: RuleItemFacts,
): boolean {
  switch (condition.kind) {
    case "group":
      return condition.match === "all"
        ? condition.conditions.every((entry) => matchCondition(entry, facts))
        : condition.conditions.some((entry) => matchCondition(entry, facts));
    case "item-type":
      return (facts.itemType === condition.values[0]) !== condition.negated;
    case "collection":
      return isInCollection(condition, facts) !== condition.negated;
    case "tags":
      return (
        matchList(condition.operator, condition.values, facts.tags) !==
        condition.negated
      );
  }
}

function matchList(
  operator: ListOperator,
  values: readonly string[],
  facts: readonly string[],
): boolean {
  switch (operator) {
    case "contains":
      return facts.includes(values[0]!);
    case "containsAny":
      return values.some((value) => facts.includes(value));
    case "containsAll":
      return values.every((value) => facts.includes(value));
    case "isEmpty":
      return facts.length === 0;
  }
}

function isInCollection(
  condition: Extract<RuleCondition, { kind: "collection" }>,
  facts: RuleItemFacts,
): boolean {
  if (
    facts.library === null ||
    selectorKey(facts.library) !== selectorKey(condition.library)
  )
    return false;
  return (
    facts.collections.includes(condition.key) ||
    (condition.descendants && facts.collectionAncestors.includes(condition.key))
  );
}

/** Every Collection a condition refers to, in source order. */
export function collectionReferences(
  condition: RuleCondition,
): CollectionReference[] {
  switch (condition.kind) {
    case "group":
      return condition.conditions.flatMap(collectionReferences);
    case "collection":
      return [{ library: condition.library, key: condition.key }];
    default:
      return [];
  }
}

/** Write the canonical expression of a condition, as the editor stores it. */
export function formatCondition(condition: RuleCondition): string {
  switch (condition.kind) {
    case "group": {
      if (condition.conditions.length === 0) return MATCH_ALL_EXPRESSION;
      const operator = condition.match === "all" ? " && " : " || ";
      return condition.conditions
        .map((entry) =>
          entry.kind === "group" && entry.conditions.length > 1
            ? `(${formatCondition(entry)})`
            : formatCondition(entry),
        )
        .join(operator);
    }
    case "item-type":
      return `${ITEM_TYPE_FIELD} ${condition.negated ? "!=" : "=="} ${JSON.stringify(condition.values[0])}`;
    case "collection": {
      const name = condition.descendants
        ? IN_COLLECTION_FUNCTION
        : IN_COLLECTION_DIRECTLY_FUNCTION;
      const call = `${name}(${JSON.stringify(selectorKey(condition.library))}, ${JSON.stringify(condition.key)})`;
      return condition.negated ? `!${call}` : call;
    }
    case "tags": {
      const args = condition.values
        .map((value) => JSON.stringify(value))
        .join(", ");
      const call = `${TAGS_FIELD}.${condition.operator}(${args})`;
      return condition.negated ? `!${call}` : call;
    }
  }
}

function emptyGroup(): RuleCondition {
  return { kind: "group", match: "all", conditions: [] };
}

class UnsupportedNode extends Error {
  constructor(
    readonly code: Exclude<
      ConditionProblem,
      { code: "missing-collection" }
    >["code"],
    readonly from: number,
    readonly to: number,
  ) {
    super(`Unsupported expression node (${code})`);
  }
}

function convert(node: ExpressionNode): RuleCondition {
  switch (node.type) {
    case "boolean":
      // `true` is the empty group; `false` never holds and has no GUI form.
      if (node.value) return emptyGroup();
      break;
    case "group":
      return convert(node.expression);
    case "unary":
      if (node.operator === "!") return negate(convert(node.operand));
      break;
    case "binary":
      if (node.operator === "&&" || node.operator === "||") {
        const match = node.operator === "&&" ? "all" : "any";
        return {
          kind: "group",
          match,
          conditions: [
            ...flatten(convert(node.left), match),
            ...flatten(convert(node.right), match),
          ],
        };
      }
      if (node.operator === "==" || node.operator === "!=")
        return equality(node, node.operator === "!=");
      break;
    case "call":
      return call(node);
  }
  throw new UnsupportedNode("unsupported", node.from, node.to);
}

/** Same-operator groups merge, so `a && b && c` reads as one flat group. */
function flatten(
  condition: RuleCondition,
  match: "all" | "any",
): RuleCondition[] {
  return condition.kind === "group" && condition.match === match
    ? condition.conditions
    : [condition];
}

function negate(condition: RuleCondition): RuleCondition {
  if (condition.kind !== "group")
    return { ...condition, negated: !condition.negated };
  // De Morgan keeps the contract closed under `!` without a `not` group.
  return {
    kind: "group",
    match: condition.match === "all" ? "any" : "all",
    conditions: condition.conditions.map(negate),
  };
}

function equality(
  node: Extract<ExpressionNode, { type: "binary" }>,
  negated: boolean,
): RuleCondition {
  const { left, right } = node;
  if (
    left.type !== "identifier" ||
    left.name !== ITEM_TYPE_FIELD ||
    right.type !== "string"
  )
    throw new UnsupportedNode("unsupported", node.from, node.to);
  if (!KNOWN_ITEM_TYPES.has(right.value))
    throw new UnsupportedNode("unknown-item-type", right.from, right.to);
  return {
    kind: "item-type",
    operator: "is",
    negated,
    values: [right.value],
  };
}

function call(node: Extract<ExpressionNode, { type: "call" }>): RuleCondition {
  const { callee, args } = node;
  if (
    callee.type === "object-access" &&
    callee.object.type === "identifier" &&
    callee.object.name === TAGS_FIELD
  ) {
    const operator = callee.property as ListOperator;
    const arityIsValid =
      (operator === "contains" && args.length === 1) ||
      ((operator === "containsAny" || operator === "containsAll") &&
        args.length >= 1) ||
      (operator === "isEmpty" && args.length === 0);
    if (!arityIsValid)
      throw new UnsupportedNode("unsupported", callee.from, callee.to);
    const invalid = args.find((arg) => arg.type !== "string");
    if (invalid)
      throw new UnsupportedNode("unsupported", invalid.from, invalid.to);
    return {
      kind: "tags",
      operator,
      negated: false,
      values: args.map(
        (arg) => (arg as Extract<ExpressionNode, { type: "string" }>).value,
      ),
    };
  }
  if (callee.type !== "identifier")
    throw new UnsupportedNode("unsupported", callee.from, callee.to);
  if (callee.name === "hasTag")
    throw new UnsupportedNode("unsupported", callee.from, callee.to);
  const strings = args.every((arg) => arg.type === "string") ? args : null;
  const descendants = callee.name === IN_COLLECTION_FUNCTION;
  if (
    (descendants || callee.name === IN_COLLECTION_DIRECTLY_FUNCTION) &&
    strings?.length === 2
  ) {
    const [library, key] = strings;
    return {
      kind: "collection",
      negated: false,
      library: parseLibraryReference(library!),
      key: key!.value,
      descendants,
    };
  }
  throw new UnsupportedNode("unsupported", node.from, node.to);
}

const GROUP_REFERENCE = regex("^group:(?<groupID>[1-9]\\d*)$");

/** Read the portable `personal` / `group:<groupID>` Library reference. */
function parseLibraryReference(
  node: Extract<ExpressionNode, { type: "string" }>,
): LibrarySelector {
  if (node.value === "personal") return { type: "personal" };
  const groupID = GROUP_REFERENCE.exec(node.value)?.groups.groupID;
  if (groupID === undefined)
    throw new UnsupportedNode("unknown-library", node.from, node.to);
  return { type: "group", groupID: Number(groupID) };
}
