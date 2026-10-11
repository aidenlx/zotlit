// Public surface: the generated Filter Expression parser plus positioned error lookup.
import type { Tree } from "@lezer/common";

import { parser } from "./generated/parser.js";
import { syntaxFault } from "./syntax-fault.js";

export { parser };

/** The first Syntax Fault, with UTF-16 source offsets and grammar display forms. */
export interface ExpressionSyntaxError {
  from: number;
  to: number;
  found: string | null;
  expected: readonly string[];
  opened: { from: number; to: number; closer: string } | null;
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
 * (the strict parser's first fault), never as a silent partial parse.
 */
export function parseExpression(input: string): ParseExpressionResult {
  const tree = parser.parse(input);
  return { tree, error: hasError(tree) ? syntaxFault(input, tree) : null };
}

function hasError(tree: Tree): boolean {
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError) return true;
  } while (cursor.next());
  return false;
}

export { parseExpressionAst, toAst } from "./ast.js";
export type {
  BinaryOperator,
  ExpressionNode,
  ParseExpressionAstResult,
} from "./ast.js";
