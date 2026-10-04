// The evaluator of a validated Filter Expression: the authority for every
// match. A failure that depends on the Item's data gives null for that node.
import type { QueryItem } from "./fields";
import { finite, invoke, methodOf, propertyOf } from "./filter-functions";
import type { FilterNode } from "./filter-plan";
import { equals, isList, order, toText, truthy, typeOf } from "./filter-values";
import type { FilterValue } from "./filter-values";

/** Whether the filter selects the Item: null is falsy. */
export function matches(root: FilterNode, item: QueryItem): boolean {
  return truthy(evaluate(root, item));
}

/** The value of a node for one Item. */
export function evaluate(node: FilterNode, item: QueryItem): FilterValue {
  switch (node.kind) {
    case "literal":
      return node.value;
    case "list":
      return node.elements.map((element) => evaluate(element, item));
    case "field":
    case "custom-field":
      return node.value.read(item);
    case "unary": {
      const operand = evaluate(node.operand, item);
      if (operand === null) return null;
      if (node.operator === "!") return !truthy(operand);
      return typeof operand === "number" ? -operand : null;
    }
    case "binary":
      return binary(node, item);
    case "if": {
      if (truthy(evaluate(node.condition, item))) {
        return evaluate(node.whenTrue, item);
      }
      return node.whenFalse ? evaluate(node.whenFalse, item) : null;
    }
    case "function":
      return invoke(
        node.definition,
        null,
        node.args.map((arg) => evaluate(arg, item)),
      );
    case "method": {
      const subject = evaluate(node.subject, item);
      const method = methodOf(typeOf(subject), node.name);
      if (!method) return null;
      return invoke(
        method,
        subject,
        node.args.map((arg) => evaluate(arg, item)),
      );
    }
    case "property": {
      const subject = evaluate(node.subject, item);
      const property = propertyOf(typeOf(subject), node.name);
      return property ? property.read(subject) : null;
    }
    case "index": {
      const subject = evaluate(node.subject, item);
      const index = evaluate(node.index, item);
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
): FilterValue {
  const { operator } = node;
  // `&&` and `||` evaluate the right side only when the left side needs it.
  if (operator === "&&") {
    return (
      truthy(evaluate(node.left, item)) && truthy(evaluate(node.right, item))
    );
  }
  if (operator === "||") {
    return (
      truthy(evaluate(node.left, item)) || truthy(evaluate(node.right, item))
    );
  }
  const left = evaluate(node.left, item);
  const right = evaluate(node.right, item);
  switch (operator) {
    case "==":
      return equals(left, right);
    case "!=":
      return !equals(left, right);
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const ordered = order(left, right);
      if (ordered === null) return null;
      if (operator === "<") return ordered < 0;
      if (operator === "<=") return ordered <= 0;
      return operator === ">" ? ordered > 0 : ordered >= 0;
    }
    case "+":
      if (typeof left === "string" || typeof right === "string") {
        // Null adds no text.
        return (
          (left === null ? "" : toText(left)) +
          (right === null ? "" : toText(right))
        );
      }
      if (isList(left) && isList(right)) return [...left, ...right];
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
