// The evaluator of a validated Filter Expression: the authority for every
// match. A failure that depends on the Item's data gives null for that node.
import type { QueryItem } from "./fields";
import { addDuration } from "./filter-dates";
import { finite, invoke, methodOf, propertyOf } from "./filter-functions";
import type { FilterNode } from "./filter-plan";
import {
  compare,
  equals,
  isDate,
  isDuration,
  isList,
  toText,
  truthy,
  typeOf,
} from "./filter-values";
import type { FilterValue } from "./filter-values";
import type { QueryClock } from "./query-clock";

/** Whether the filter selects the Item: null is falsy. */
export function matches(
  root: FilterNode,
  item: QueryItem,
  clock: QueryClock,
): boolean {
  return truthy(evaluate(root, item, clock));
}

/**
 * The value of a node for one Item. Every date function and every
 * calendar-day comparison reads `clock`, the Query Clock of the query.
 */
export function evaluate(
  node: FilterNode,
  item: QueryItem,
  clock: QueryClock,
): FilterValue {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "list":
      return node.elements.map((element) => evaluate(element, item, clock));
    case "field":
    case "custom-field":
      return node.value.read(item);
    case "unary": {
      const operand = evaluate(node.operand, item, clock);
      // Null is falsy, so `!` of null is true.
      if (node.operator === "!") return !truthy(operand);
      return typeof operand === "number" ? -operand : null;
    }
    case "binary":
      return binary(node, item, clock);
    case "if": {
      if (truthy(evaluate(node.condition, item, clock))) {
        return evaluate(node.whenTrue, item, clock);
      }
      return node.whenFalse ? evaluate(node.whenFalse, item, clock) : null;
    }
    case "function":
      return invoke(
        node.definition,
        {
          subject: null,
          args: node.args.map((arg) => evaluate(arg, item, clock)),
        },
        clock,
      );
    case "method": {
      const subject = evaluate(node.subject, item, clock);
      const method = methodOf(typeOf(subject), node.name);
      if (!method) return null;
      return invoke(
        method,
        {
          subject,
          args: node.args.map((arg) => evaluate(arg, item, clock)),
        },
        clock,
      );
    }
    case "property": {
      const subject = evaluate(node.subject, item, clock);
      const property = propertyOf(typeOf(subject), node.name);
      return property ? property.read(subject, clock) : null;
    }
    case "index": {
      const subject = evaluate(node.subject, item, clock);
      const index = evaluate(node.index, item, clock);
      if (typeof index !== "number" || !Number.isInteger(index)) return null;
      if (!isList(subject) && typeof subject !== "string") return null;
      // A negative index counts from the end.
      return subject[index < 0 ? index + subject.length : index] ?? null;
    }
  }
}

function binary(
  node: Extract<FilterNode, { kind: "binary" }>,
  item: QueryItem,
  clock: QueryClock,
): FilterValue {
  const { operator } = node;
  // `&&` and `||` evaluate the right side only when the left side needs it.
  if (operator === "&&") {
    return (
      truthy(evaluate(node.left, item, clock)) &&
      truthy(evaluate(node.right, item, clock))
    );
  }
  if (operator === "||") {
    return (
      truthy(evaluate(node.left, item, clock)) ||
      truthy(evaluate(node.right, item, clock))
    );
  }
  const left = evaluate(node.left, item, clock);
  const right = evaluate(node.right, item, clock);
  switch (operator) {
    case "==":
      return equals(left, right, clock);
    case "!=":
      return !equals(left, right, clock);
    case "<":
    case "<=":
    case ">":
    case ">=":
      return compare(operator, [left, right], clock);
    case "+":
      if (typeof left === "string" || typeof right === "string") {
        // Null adds no text.
        return (
          (left === null ? "" : toText(left)) +
          (right === null ? "" : toText(right))
        );
      }
      if (isList(left) && isList(right)) return [...left, ...right];
      // Date arithmetic follows the calendar of the query time zone.
      if (isDate(left) && isDuration(right)) {
        return addDuration(left, right.duration, clock);
      }
      if (isDuration(left) && isDate(right)) {
        return addDuration(right, left.duration, clock);
      }
      break;
    case "-":
      if (isDate(left) && isDuration(right)) {
        return addDuration(left, right.duration.negated(), clock);
      }
      break;
  }
  if (typeof left !== "number" || typeof right !== "number") return null;
  switch (operator) {
    case "+":
      return finite(left + right);
    case "-":
      return finite(left - right);
    case "*":
      return finite(left * right);
    case "/":
      return finite(left / right);
    case "%":
      return finite(left % right);
  }
}
