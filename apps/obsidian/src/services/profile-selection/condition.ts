/**
 * The condition contract of a Profile Selection Rule: which Filter
 * Expressions a rule may carry, how the editor writes one, and how one is
 * matched against the facts of a Zotero Item.
 *
 * The shared language parses far more than a rule accepts. This module is the
 * gate: an expression compiles to a {@link RuleCondition} only when every node
 * belongs to the supported vocabulary, and anything else is a
 * {@link ConditionProblem} — reported when the rule is edited and again when
 * it is evaluated, so a rule the vault cannot judge never selects a Profile.
 *
 * Supported today: `itemType == "<type>"`, `itemType != "<type>"`, `!`,
 * `&&`, `||`, and grouping. Later slices add Collection and Tag predicates
 * to {@link RuleCondition} and to {@link RuleItemFacts} without changing the
 * gate's shape.
 */
import { parseExpressionAst } from "@zotlit/filter-expression";
import type { ExpressionNode } from "@zotlit/filter-expression";
import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

/** The Item field a rule may test. */
export const ITEM_TYPE_FIELD = "itemType";

export type RuleCondition =
  | {
      kind: "group";
      /** `all`: every condition must hold; `any`: at least one must. */
      match: "all" | "any";
      conditions: RuleCondition[];
    }
  | { kind: "item-type"; negated: boolean; itemType: string };

/** One reason an expression is outside the supported contract. */
export interface ConditionProblem {
  code: "syntax" | "unsupported" | "unknown-item-type";
  /** Source range of the offending node, for the editor to point at. */
  from: number;
  to: number;
  /** The offending source text (empty for a missing token). */
  text: string;
}

export type CompiledCondition =
  | { condition: RuleCondition; problem: null }
  | { condition: null; problem: ConditionProblem };

/** The Item facts a condition reads. Later slices add memberships. */
export interface RuleItemFacts {
  itemType: string;
}

const KNOWN_ITEM_TYPES = new Set(ITEM_TYPES.map(({ name }) => name));

/** The expression an empty "Match all" group writes: it holds for every Item. */
export const MATCH_ALL_EXPRESSION = "true";

/**
 * Validate an expression against the supported contract.
 *
 * A blank expression is the empty "Match all" group. `true` on its own is the
 * same group, which is how {@link formatCondition} writes it.
 */
export function compileCondition(expression: string): CompiledCondition {
  const source = expression.trim();
  if (source === "") return { condition: emptyGroup(), problem: null };
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
      return (facts.itemType === condition.itemType) !== condition.negated;
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
      return `${ITEM_TYPE_FIELD} ${condition.negated ? "!=" : "=="} ${JSON.stringify(condition.itemType)}`;
  }
}

/**
 * The flat "Match all" view of a condition, or `null` when the expression
 * carries structure the simple editor cannot show (an `any` group, a nested
 * group). The editor keeps such an expression intact instead of flattening it.
 */
export function flatConditions(
  condition: RuleCondition,
): Extract<RuleCondition, { kind: "item-type" }>[] | null {
  if (condition.kind !== "group") return [condition];
  if (condition.match !== "all") return null;
  const flat: Extract<RuleCondition, { kind: "item-type" }>[] = [];
  for (const entry of condition.conditions) {
    if (entry.kind === "group") return null;
    flat.push(entry);
  }
  return flat;
}

function emptyGroup(): RuleCondition {
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
  if (condition.kind === "item-type")
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
  return { kind: "item-type", negated, itemType: right.value };
}
