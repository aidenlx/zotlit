import { Context, toValueSync, Value, type Liquid } from "liquidjs";

import { basename } from "./basename";
import {
  type FrontmatterField,
  type FrontmatterLanguage,
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

export interface CompileFrontmatterOptions {
  /** Shared Liquid engine providing the same vocabulary as the templates. */
  liquid: Liquid;
  /** JavaScript Templates gate: when false, javascript fields are skipped uncompiled. */
  javascript: boolean;
}

export interface CompiledFrontmatter {
  compiled: CompiledFrontmatterField[];
  /** Keys of javascript fields skipped (never compiled) because the gate is off. */
  inertKeys: string[];
}

/**
 * Compile each field's `expr` into a reusable evaluator, dropping empty keys.
 *
 * A `"javascript"` field is user-authored JS (trusted, local config)
 * evaluated via `new Function`, so values return verbatim (numbers/arrays/
 * objects stay intact) — which is why this can't route through `Eta.render`.
 * With {@link CompileFrontmatterOptions.javascript} off, javascript fields are
 * filtered out before compilation (never compiled-then-skipped) and their
 * keys collected into {@link CompiledFrontmatter.inertKeys}: the hard
 * invariant is that no dynamic code compilation runs anywhere with the gate
 * off.
 *
 * A `"liquid"` field compiles once via liquidjs's `Value`, whose evaluator
 * feeds a fresh `Context` per call so typed values (arrays, numbers, null)
 * return verbatim, same as the JS path.
 *
 * A syntactically invalid `expr` (either language) compiles to an evaluator
 * that throws at eval time, so {@link evalFrontmatterFields} reports it
 * per-field through `onError` rather than this aborting the whole set.
 */
export function compileFrontmatterFields(
  fields: readonly FrontmatterField[],
  options: CompileFrontmatterOptions,
): CompiledFrontmatter {
  const compiled: CompiledFrontmatterField[] = [];
  const inertKeys: string[] = [];
  for (const field of fields) {
    if (!field.key) continue;
    if (field.language === "javascript") {
      if (!options.javascript) {
        inertKeys.push(field.key);
        continue;
      }
      compiled.push({
        key: field.key,
        fn: toEvaluator(field.expr),
        merge: field.merge,
      });
    } else {
      compiled.push({
        key: field.key,
        fn: toLiquidEvaluator(field.expr, options.liquid),
        merge: field.merge,
      });
    }
  }
  return { compiled, inertKeys };
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
 * Defer a parse error to eval time, matching {@link toEvaluator}. `basename`
 * is ignored — liquid fields have no equivalent helper injected.
 */
function toLiquidEvaluator(expr: string, liquid: Liquid): FrontmatterEvaluator {
  try {
    const value = new Value(expr, liquid);
    return (zt) =>
      toValueSync(value.value(new Context({ zt }, liquid.options)));
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
export function validateFrontmatterExpr(
  expr: string,
  language: FrontmatterLanguage,
  liquid: Liquid,
): string | null {
  try {
    if (language === "javascript") compileExpr(expr);
    else new Value(expr, liquid);
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
export type { FrontmatterField, FrontmatterLanguage } from "./constants";
