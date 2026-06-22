import { basename } from "./basename";
import {
  type FrontmatterField,
  type FrontmatterMergeStrategy,
} from "./constants";

type BasenameHelper = (path: string, ext?: string) => string;
type FrontmatterEvaluator = (zt: object, basename: BasenameHelper) => unknown;

/** A {@link FrontmatterField} whose `expr` is compiled once for repeated eval. */
export interface CompiledFrontmatterField {
  key: string;
  fn: FrontmatterEvaluator;
  merge: FrontmatterMergeStrategy;
}

/**
 * Compile each field's `expr` into a reusable evaluator, dropping empty keys.
 * The expressions are user-authored JS (trusted, local config) evaluated via
 * `new Function`; values are returned verbatim (numbers/arrays/objects stay
 * intact), which is why this can't route through `Eta.render`.
 *
 * A syntactically invalid `expr` compiles to an evaluator that throws at eval
 * time, so {@link evalFrontmatterFields} reports it per-field through `onError`
 * rather than this aborting the whole set.
 */
export function compileFrontmatterFields(
  fields: readonly FrontmatterField[],
): CompiledFrontmatterField[] {
  const compiled: CompiledFrontmatterField[] = [];
  for (const field of fields) {
    if (!field.key) continue;
    compiled.push({
      key: field.key,
      fn: toEvaluator(field.expr),
      merge: field.merge,
    });
  }
  return compiled;
}

function compileExpr(expr: string): FrontmatterEvaluator {
  // Newline before `)` so an expr ending in a `//` line comment doesn't swallow
  // the closing paren — matches the engine's `#assertExpressionSyntax` check.
  // oxlint-disable-next-line no-implied-eval
  return new Function(
    "zt",
    "basename",
    `return (${expr}\n);`,
  ) as FrontmatterEvaluator;
}

/** Defer a syntax error to eval time so {@link evalFrontmatterFields} reports it. */
function toEvaluator(expr: string): FrontmatterEvaluator {
  try {
    return compileExpr(expr);
  } catch (error) {
    return () => {
      throw error;
    };
  }
}

/**
 * Compile-check a single expression for the settings UI.
 * @returns `null` when `expr` compiles, or the error message when it does not.
 */
export function validateFrontmatterExpr(expr: string): string | null {
  try {
    compileExpr(expr);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Evaluate precompiled fields over `zt` into a record. A field whose evaluator
 * throws (invalid expression or runtime error) is skipped and reported via
 * `onError` rather than aborting the rest.
 */
export function evalFrontmatterFields(
  fields: readonly Pick<CompiledFrontmatterField, "key" | "fn">[],
  zt: object,
  onError?: (key: string, error: unknown) => void,
): Record<string, unknown> {
  const fm: Record<string, unknown> = {};
  for (const field of fields) {
    try {
      const value = field.fn(zt, basename);
      if (value !== undefined) fm[field.key] = value;
    } catch (error) {
      onError?.(field.key, error);
    }
  }
  return fm;
}

export { basename };
export type { FrontmatterField } from "./constants";
