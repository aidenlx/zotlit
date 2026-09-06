// Compile Profile Match conditions and evaluate them against an Item's Library, type, Tags, and Collections.
import { parseExpressionAst } from "@zotlit/filter-expression";
import type { ExpressionNode } from "@zotlit/filter-expression";
import type { MatchTree } from "@zotlit/templates/facade";
import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

import { selectorKey } from "@/services/library-scope/scope";
import type {
  AvailableLibrary,
  LibrarySelector,
} from "@/services/library-scope/scope";

/** The Item field a match may test. */
export const LIBRARY_FIELD = "library";
export const ITEM_TYPE_FIELD = "itemType";
export const TAGS_FIELD = "tags";
export const COLLECTIONS_FIELD = "collections";

export type ListOperator =
  | "contains"
  | "containsAny"
  | "containsAll"
  | "isEmpty";
export type CollectionOperator = ListOperator | "within";

export type MatchCondition =
  | {
      kind: "group";
      /** `all`: every condition must hold; `any`: at least one must. */
      match: "all" | "any";
      conditions: MatchCondition[];
    }
  | {
      kind: "library";
      operator: "is";
      negated: boolean;
      values: [string];
    }
  | {
      kind: "item-type";
      operator: "is";
      negated: boolean;
      values: [string];
    }
  | {
      kind: "collections";
      operator: CollectionOperator;
      negated: boolean;
      /** Root-first paths, split into segments at compile time. */
      values: (readonly string[])[];
    }
  | {
      kind: "tags";
      operator: ListOperator;
      negated: boolean;
      values: string[];
    };

/** A condition the editor shows as one row. */
export type FlatCondition = Exclude<MatchCondition, { kind: "group" }>;

/** One reason an expression is outside the supported contract. */
export type ConditionProblem = {
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
};

export type CompiledCondition =
  | { condition: MatchCondition; problem: null }
  | { condition: null; problem: ConditionProblem };

/** The Item facts a condition reads. */
export interface MatchItemFacts {
  /** `null` for a group Library Zotero reports no group ID for. */
  library: LibrarySelector | null;
  itemType: string;
  /** Every Tag name applied to the Item, manual and automatic alike. */
  tags: readonly string[];
  /** Root-first paths of the Collections the Item is filed in directly. */
  collections: readonly (readonly string[])[];
}

const KNOWN_ITEM_TYPES = new Set(ITEM_TYPES.map(({ name }) => name));

/** The expression of an empty "Match all" group: it holds for every Item. */
const MATCH_ALL_EXPRESSION = "true";

/**
 * Validate a Match tree against the supported contract: every leaf compiles,
 * and each group becomes a "Match all" / "Match any" group in tree order.
 * The first problem found, in reading order, is the filter's problem.
 */
export function compileFilter(
  filter: MatchTree,
  libraries?: readonly AvailableLibrary[],
): CompiledCondition {
  if (typeof filter === "string") return compileCondition(filter, libraries);
  const match = "and" in filter ? "all" : "any";
  const entries = "and" in filter ? filter.and : filter.or;
  const conditions: MatchCondition[] = [];
  for (const entry of entries) {
    const compiled = compileFilter(entry, libraries);
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
 * writes it. Supplying `libraries` also checks that named Libraries exist.
 */
export function compileCondition(
  expression: string,
  libraries?: readonly AvailableLibrary[],
): CompiledCondition {
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
    return { condition: convert(parsed.ast, libraries), problem: null };
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
  condition: MatchCondition,
  facts: MatchItemFacts,
): boolean {
  switch (condition.kind) {
    case "group":
      return condition.match === "all"
        ? condition.conditions.every((entry) => matchCondition(entry, facts))
        : condition.conditions.some((entry) => matchCondition(entry, facts));
    case "library":
      return (
        (facts.library !== null &&
          selectorKey(facts.library) === condition.values[0]) !==
        condition.negated
      );
    case "item-type":
      return (facts.itemType === condition.values[0]) !== condition.negated;
    case "collections":
      return (
        matchCollections(condition, facts.collections) !== condition.negated
      );
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

function matchCollections(
  condition: Extract<MatchCondition, { kind: "collections" }>,
  facts: readonly (readonly string[])[],
): boolean {
  if (condition.operator === "within") {
    const expected = condition.values[0]!;
    return facts.some((path) =>
      expected.every((segment, index) => path[index] === segment),
    );
  }
  const paths = facts.map((path) => path.join("/"));
  return matchList(
    condition.operator,
    condition.values.map((path) => path.join("/")),
    paths,
  );
}

/** Write the canonical expression of a condition, as the editor stores it. */
export function formatCondition(condition: MatchCondition): string {
  switch (condition.kind) {
    case "group": {
      if (condition.conditions.length === 0)
        return condition.match === "all"
          ? MATCH_ALL_EXPRESSION
          : `!${MATCH_ALL_EXPRESSION}`;
      const operator = condition.match === "all" ? " && " : " || ";
      return condition.conditions
        .map((entry) =>
          entry.kind === "group" && entry.conditions.length > 1
            ? `(${formatCondition(entry)})`
            : formatCondition(entry),
        )
        .join(operator);
    }
    case "library":
    case "item-type":
      return `${condition.kind === "library" ? LIBRARY_FIELD : ITEM_TYPE_FIELD} ${condition.negated ? "!=" : "=="} ${JSON.stringify(condition.values[0])}`;
    case "collections": {
      const args =
        condition.operator === "isEmpty"
          ? ""
          : condition.values
              .map((path) => JSON.stringify(path.join("/")))
              .join(", ");
      const call = `${COLLECTIONS_FIELD}.${condition.operator}(${args})`;
      return condition.negated ? `!${call}` : call;
    }
    case "tags": {
      const args =
        condition.operator === "isEmpty"
          ? ""
          : condition.values.map((value) => JSON.stringify(value)).join(", ");
      const call = `${TAGS_FIELD}.${condition.operator}(${args})`;
      return condition.negated ? `!${call}` : call;
    }
  }
}

function emptyGroup(): MatchCondition {
  return { kind: "group", match: "all", conditions: [] };
}

class UnsupportedNode extends Error {
  constructor(
    readonly code: ConditionProblem["code"],
    readonly from: number,
    readonly to: number,
  ) {
    super(`Unsupported expression node (${code})`);
  }
}

function convert(
  node: ExpressionNode,
  libraries?: readonly AvailableLibrary[],
): MatchCondition {
  switch (node.type) {
    case "boolean":
      // `true` is the empty group; `false` never holds and has no GUI form.
      if (node.value) return emptyGroup();
      break;
    case "group":
      return convert(node.expression, libraries);
    case "unary":
      if (node.operator === "!")
        return negate(convert(node.operand, libraries));
      break;
    case "binary":
      if (node.operator === "&&" || node.operator === "||") {
        const match = node.operator === "&&" ? "all" : "any";
        return {
          kind: "group",
          match,
          conditions: [
            ...flatten(convert(node.left, libraries), match),
            ...flatten(convert(node.right, libraries), match),
          ],
        };
      }
      if (node.operator === "==" || node.operator === "!=")
        return equality(node, node.operator === "!=", libraries);
      break;
    case "call":
      return call(node);
  }
  throw new UnsupportedNode("unsupported", node.from, node.to);
}

/** Same-operator groups merge, so `a && b && c` reads as one flat group. */
function flatten(
  condition: MatchCondition,
  match: "all" | "any",
): MatchCondition[] {
  return condition.kind === "group" && condition.match === match
    ? condition.conditions
    : [condition];
}

function negate(condition: MatchCondition): MatchCondition {
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
  libraries?: readonly AvailableLibrary[],
): MatchCondition {
  const { left, right } = node;
  if (
    left.type !== "identifier" ||
    (left.name !== ITEM_TYPE_FIELD && left.name !== LIBRARY_FIELD) ||
    right.type !== "string"
  )
    throw new UnsupportedNode("unsupported", node.from, node.to);
  if (left.name === LIBRARY_FIELD) {
    const groupID = right.value.startsWith("group:")
      ? Number(right.value.slice(6))
      : Number.NaN;
    const valid =
      right.value === "personal" ||
      (Number.isSafeInteger(groupID) &&
        groupID > 0 &&
        right.value === `group:${groupID}`);
    if (
      !valid ||
      (libraries !== undefined &&
        !libraries.some(
          ({ selector }) => selectorKey(selector) === right.value,
        ))
    )
      throw new UnsupportedNode("unknown-library", right.from, right.to);
    return { kind: "library", operator: "is", negated, values: [right.value] };
  }
  if (!KNOWN_ITEM_TYPES.has(right.value))
    throw new UnsupportedNode("unknown-item-type", right.from, right.to);
  return {
    kind: "item-type",
    operator: "is",
    negated,
    values: [right.value],
  };
}

function call(node: Extract<ExpressionNode, { type: "call" }>): MatchCondition {
  const { callee, args } = node;
  if (callee.type === "object-access" && callee.object.type === "identifier") {
    const field = callee.object.name;
    const operator = callee.property as CollectionOperator;
    const isTags = field === TAGS_FIELD;
    const isCollections = field === COLLECTIONS_FIELD;
    const arityIsValid =
      (operator === "contains" && args.length === 1) ||
      ((operator === "containsAny" || operator === "containsAll") &&
        args.length >= 1) ||
      (operator === "isEmpty" && args.length === 0) ||
      (isCollections && operator === "within" && args.length === 1);
    if ((!isTags && !isCollections) || !arityIsValid)
      throw new UnsupportedNode("unsupported", callee.from, callee.to);
    const invalid = args.find((arg) => arg.type !== "string");
    if (invalid)
      throw new UnsupportedNode("unsupported", invalid.from, invalid.to);
    const values = args.map(
      (arg) => (arg as Extract<ExpressionNode, { type: "string" }>).value,
    );
    return isTags
      ? {
          kind: "tags",
          operator: operator as ListOperator,
          negated: false,
          values,
        }
      : {
          kind: "collections",
          operator,
          negated: false,
          values: values.map((path) => path.split("/")),
        };
  }
  if (callee.type !== "identifier")
    throw new UnsupportedNode("unsupported", callee.from, callee.to);
  if (
    callee.name === "hasTag" ||
    callee.name === "inCollection" ||
    callee.name === "inCollectionDirectly"
  )
    throw new UnsupportedNode("unsupported", callee.from, callee.to);
  throw new UnsupportedNode("unsupported", node.from, node.to);
}
