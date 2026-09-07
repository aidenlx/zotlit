// Public surface: the generated Filter Expression parser plus positioned error lookup.
import type { Tree } from "@lezer/common";

import { parser } from "./generated/parser.js";

export { parser };

/** Source range of the first syntax-error node in a parse (zero-width when a token was expected but missing). */
export interface ExpressionSyntaxError {
  from: number;
  to: number;
}

export interface ParseExpressionResult {
  tree: Tree;
  /** `null` when the input parsed cleanly. */
  error: ExpressionSyntaxError | null;
}

/**
 * Parse a ZotLit Filter Expression.
 *
 * Lezer always produces a tree; malformed input is reported through `error`
 * (the first error node in document order), never as a silent partial parse.
 */
export function parseExpression(input: string): ParseExpressionResult {
  const tree = parser.parse(input);
  return { tree, error: findFirstError(tree) };
}

function findFirstError(tree: Tree): ExpressionSyntaxError | null {
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError) return { from: cursor.from, to: cursor.to };
  } while (cursor.next());
  return null;
}

export { parseExpressionAst, toAst } from "./ast.js";
export type {
  BinaryOperator,
  ExpressionNode,
  ParseExpressionAstResult,
} from "./ast.js";
