/** A user-configured frontmatter entry: `key` mapped to a JS `expr` over `zt`. */
export interface FrontmatterField {
  key: string;
  expr: string;
}

/** A {@link FrontmatterField} whose `expr` is compiled once for repeated eval. */
export interface CompiledFrontmatterField {
  key: string;
  fn: (zt: object) => unknown;
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
    compiled.push({ key: field.key, fn: toEvaluator(field.expr) });
  }
  return compiled;
}

function compileExpr(expr: string): (zt: object) => unknown {
  // Newline before `)` so an expr ending in a `//` line comment doesn't swallow
  // the closing paren — matches the engine's `#assertExpressionSyntax` check.
  // oxlint-disable-next-line no-implied-eval
  return new Function("zt", `return (${expr}\n);`) as (zt: object) => unknown;
}

/** Defer a syntax error to eval time so {@link evalFrontmatterFields} reports it. */
function toEvaluator(expr: string): (zt: object) => unknown {
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
  fields: readonly CompiledFrontmatterField[],
  zt: object,
  onError?: (key: string, error: unknown) => void,
): Record<string, unknown> {
  const fm: Record<string, unknown> = {};
  for (const field of fields) {
    try {
      fm[field.key] = field.fn(zt);
    } catch (error) {
      onError?.(field.key, error);
    }
  }
  return fm;
}
