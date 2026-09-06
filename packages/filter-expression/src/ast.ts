// Typed syntax tree over a parsed Filter Expression. Consumers that validate
// a vocabulary (which identifiers and calls they accept) walk this tree
// instead of the raw Lezer nodes, so the node names and token layout of the
// grammar stay private to this package.
import type { SyntaxNode, Tree } from "@lezer/common";

import { parseExpression } from "./index.js";
import type { ExpressionSyntaxError } from "./index.js";

interface Positioned {
  from: number;
  to: number;
}

export type BinaryOperator =
  | "||"
  | "&&"
  | "=="
  | "!="
  | "<="
  | ">="
  | "<"
  | ">"
  | "+"
  | "-"
  | "*"
  | "/"
  | "%";

export type ExpressionNode =
  | (Positioned & {
      type: "binary";
      operator: BinaryOperator;
      left: ExpressionNode;
      right: ExpressionNode;
    })
  | (Positioned & {
      type: "unary";
      operator: "!" | "-";
      operand: ExpressionNode;
    })
  | (Positioned & {
      type: "call";
      callee: ExpressionNode;
      args: ExpressionNode[];
    })
  | (Positioned & {
      type: "array-access";
      object: ExpressionNode;
      index: ExpressionNode;
    })
  | (Positioned & {
      type: "object-access";
      object: ExpressionNode;
      property: string;
    })
  | (Positioned & { type: "identifier"; name: string })
  | (Positioned & { type: "null" })
  | (Positioned & { type: "boolean"; value: boolean })
  | (Positioned & { type: "number"; value: number })
  | (Positioned & { type: "string"; value: string })
  | (Positioned & { type: "regexp"; source: string; flags: string })
  | (Positioned & { type: "array"; elements: ExpressionNode[] })
  | (Positioned & { type: "group"; expression: ExpressionNode });

export type ParseExpressionAstResult =
  | { ast: ExpressionNode; error: null }
  | { ast: null; error: ExpressionSyntaxError };

/**
 * Parse a Filter Expression into a typed tree. A syntax error yields no tree:
 * consumers validate a vocabulary only over well-formed input.
 */
export function parseExpressionAst(input: string): ParseExpressionAstResult {
  const { tree, error } = parseExpression(input);
  if (error) return { ast: null, error };
  return { ast: toAst(tree, input), error: null };
}

/** Convert a clean parse into its typed tree. */
export function toAst(tree: Tree, input: string): ExpressionNode {
  const expression = tree.topNode.firstChild;
  if (!expression) throw new Error("Empty expression");
  return convert(expression, input);
}

function convert(node: SyntaxNode, input: string): ExpressionNode {
  const { from, to } = node;
  const text = () => input.slice(from, to);
  switch (node.name) {
    case "LogicalExpression":
    case "EqualityExpression":
    case "RelationalExpression":
    case "AdditiveExpression":
    case "MultiplicativeExpression": {
      const [left, operator, right] = children(node);
      return {
        type: "binary",
        operator: input.slice(operator!.from, operator!.to) as BinaryOperator,
        left: convert(left!, input),
        right: convert(right!, input),
        from,
        to,
      };
    }
    case "UnaryExpression": {
      const [operator, operand] = children(node);
      return {
        type: "unary",
        operator: input.slice(operator!.from, operator!.to) as "!" | "-",
        operand: convert(operand!, input),
        from,
        to,
      };
    }
    case "Call": {
      const [callee, ...rest] = children(node);
      return {
        type: "call",
        callee: convert(callee!, input),
        args: rest.filter(isExpression).map((arg) => convert(arg, input)),
        from,
        to,
      };
    }
    case "ArrayAccess": {
      const [object, , index] = children(node);
      return {
        type: "array-access",
        object: convert(object!, input),
        index: convert(index!, input),
        from,
        to,
      };
    }
    case "ObjectAccess": {
      const [object, , property] = children(node);
      return {
        type: "object-access",
        object: convert(object!, input),
        property: input.slice(property!.from, property!.to),
        from,
        to,
      };
    }
    case "Identifier":
      return { type: "identifier", name: text(), from, to };
    case "NullLiteral":
      return { type: "null", from, to };
    case "BooleanLiteral":
      return { type: "boolean", value: text() === "true", from, to };
    case "RealNumber":
      return { type: "number", value: Number(text()), from, to };
    case "String":
      return { type: "string", value: unquote(text()), from, to };
    case "RegExp": {
      const source = text();
      const end = source.lastIndexOf("/");
      return {
        type: "regexp",
        source: source.slice(1, end),
        flags: source.slice(end + 1),
        from,
        to,
      };
    }
    case "Array":
      return {
        type: "array",
        elements: children(node)
          .filter(isExpression)
          .map((element) => convert(element, input)),
        from,
        to,
      };
    case "GroupedExpression": {
      const [, expression] = children(node);
      return {
        type: "group",
        expression: convert(expression!, input),
        from,
        to,
      };
    }
    default:
      throw new Error(`Unexpected node ${node.name}`);
  }
}

function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling)
    result.push(child);
  return result;
}

const PUNCTUATION = new Set(["(", ")", "[", "]", ",", "."]);

function isExpression(node: SyntaxNode): boolean {
  return !PUNCTUATION.has(node.name);
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r" };

/** Strip the quotes of a string literal and resolve its `\` escapes. */
function unquote(literal: string): string {
  const body = literal.slice(1, -1);
  let result = "";
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (char !== "\\" || i + 1 >= body.length) {
      result += char;
      continue;
    }
    const next = body[++i]!;
    result += ESCAPES[next] ?? next;
  }
  return result;
}
