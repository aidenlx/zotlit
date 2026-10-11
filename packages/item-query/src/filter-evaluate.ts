// The evaluator of a validated Filter Expression: the authority for every
// match. A failure that depends on the Item's data gives null for that node.
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

/** The values of the names the enclosing element expressions bind. */
type Bindings = ReadonlyMap<string, FilterValue>;

/** What one evaluation reads: the Item, the Query Clock, and the bindings. */
interface Context<Item> {
  readonly item: Item;
  readonly clock: QueryClock;
  readonly bindings: Bindings;
}

/** Whether the filter selects the Item: null is falsy. */
export function matches<Item>(
  root: FilterNode<Item>,
  item: Item,
  clock: QueryClock,
): boolean {
  return truthy(evaluate(root, item, clock));
}

/**
 * The value of a node for one Item. Every date function and every
 * calendar-day comparison reads `clock`, the Query Clock of the query.
 */
export function evaluate<Item>(
  node: FilterNode<Item>,
  item: Item,
  clock: QueryClock,
): FilterValue {
  return valueOf(node, { item, clock, bindings: new Map() });
}

/** The value of a node in `context`. */
function valueOf<Item>(
  node: FilterNode<Item>,
  context: Context<Item>,
): FilterValue {
  const { item, clock, bindings } = context;
  const value = (child: FilterNode<Item>) => valueOf(child, context);
  switch (node.kind) {
    case "literal":
      return node.value;
    case "list":
      return node.elements.map(value);
    case "field":
    case "custom-field":
      return node.value.read(item);
    case "binding":
      return bindings.get(node.name) ?? null;
    case "unary": {
      const operand = value(node.operand);
      // Null is falsy, so `!` of null is true.
      if (node.operator === "!") return !truthy(operand);
      return typeof operand === "number" ? -operand : null;
    }
    case "binary":
      return binary(node, context);
    case "if": {
      if (truthy(value(node.condition))) return value(node.whenTrue);
      return node.whenFalse ? value(node.whenFalse) : null;
    }
    case "function":
      return invoke(
        node.definition,
        { subject: null, args: node.args.map(value) },
        clock,
      );
    case "method": {
      const subject = value(node.subject);
      const method = methodOf(typeOf(subject), node.name);
      if (!method) return null;
      return invoke(method, { subject, args: node.args.map(value) }, clock);
    }
    case "element":
      return element(node, context);
    case "property": {
      const subject = value(node.subject);
      if (node.read) return node.read(subject);
      const property = propertyOf(typeOf(subject), node.name);
      return property ? property.read(subject, clock) : null;
    }
    case "index": {
      const subject = value(node.subject);
      const index = value(node.index);
      if (typeof index !== "number" || !Number.isInteger(index)) return null;
      if (!isList(subject) && typeof subject !== "string") return null;
      // A negative index counts from the end.
      return subject[index < 0 ? index + subject.length : index] ?? null;
    }
  }
}

/**
 * An element expression: the expression runs once for each element of the
 * list with `value` and `index` bound, and `acc` in `reduce`. A subject that
 * is not a list gives null; `initial` is evaluated once, outside the binding.
 */
function element<Item>(
  node: Extract<FilterNode<Item>, { kind: "element" }>,
  context: Context<Item>,
): FilterValue {
  const subject = valueOf(node.subject, context);
  if (!isList(subject)) return null;
  const args = node.args.map((arg) => valueOf(arg, context));
  const at = (index: number, acc?: FilterValue): FilterValue =>
    valueOf(node.expression, {
      ...context,
      bindings: new Map([
        ...context.bindings,
        ["value", subject[index]!],
        ["index", index],
        ...(acc === undefined ? [] : [["acc", acc] as const]),
      ]),
    });
  switch (node.name) {
    case "filter":
      return subject.filter((_element, index) => truthy(at(index)));
    case "map":
      return subject.map((_element, index) => at(index));
    case "reduce":
      return subject.reduce<FilterValue>(
        (acc, _element, index) => at(index, acc),
        args[0] ?? null,
      );
    default:
      return null;
  }
}

function binary<Item>(
  node: Extract<FilterNode<Item>, { kind: "binary" }>,
  context: Context<Item>,
): FilterValue {
  const { operator } = node;
  const { clock } = context;
  const value = (child: FilterNode<Item>) => valueOf(child, context);
  // `&&` and `||` evaluate the right side only when the left side needs it.
  if (operator === "&&") {
    return truthy(value(node.left)) && truthy(value(node.right));
  }
  if (operator === "||") {
    return truthy(value(node.left)) || truthy(value(node.right));
  }
  const left = value(node.left);
  const right = value(node.right);
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
