import { Context, toValueSync, Value } from "liquidjs";
import type { Liquid } from "liquidjs";
import { stringify as stringifyYaml } from "yaml";

import { basename } from "./basename";
import type {
  FrontmatterField,
  FrontmatterLanguage,
  FrontmatterMergeStrategy,
} from "./constants";
import {
  assertFrontmatterOutputDomain,
  assertFrontmatterSpreadOutput,
  ManagedFrontmatterError,
  renderJsonEFrontmatterValue,
} from "./frontmatter-json-e";
import type { FrontmatterJsonValue } from "./frontmatter-json-e";
import { FRONTMATTER_ABSENT } from "./frontmatter-merge";
import type { EvaluatedFrontmatterField } from "./frontmatter-merge";
import type { ManagedFrontmatterEntry } from "./literature-note-template";

export {
  FrontmatterJsonEError,
  renderJsonEFrontmatterValue,
} from "./frontmatter-json-e";
export type {
  FrontmatterJsonValue,
  RenderJsonEFrontmatterValueOptions,
} from "./frontmatter-json-e";
export { FRONTMATTER_ABSENT } from "./frontmatter-merge";

type BasenameHelper = (path: string, ext?: string) => string;
type FrontmatterEvaluator = (zt: object, basename: BasenameHelper) => unknown;

/** A {@link FrontmatterField} whose `expr` is compiled once for repeated eval. */
export interface CompiledFrontmatterField {
  key: string;
  fn: FrontmatterEvaluator;
  merge: FrontmatterMergeStrategy;
}

type ManagedFrontmatterEvaluator = (
  zt: object,
  operationTimestamp: Temporal.Instant,
) => unknown;

export type CompiledManagedFrontmatterEntry = {
  readonly position: number;
  readonly merge: FrontmatterMergeStrategy;
} & (
  | { readonly key: string; readonly fn: ManagedFrontmatterEvaluator }
  | {
      readonly key: undefined;
      readonly fn: (
        zt: object,
        operationTimestamp: Temporal.Instant,
      ) => Record<string, FrontmatterJsonValue> | typeof FRONTMATTER_ABSENT;
    }
);

export interface CompiledManagedFrontmatter {
  readonly compiled: readonly CompiledManagedFrontmatterEntry[];
  readonly inertKeys: readonly string[];
}

export interface ManagedFrontmatterEvaluationError {
  readonly key: string;
  readonly error: unknown;
}

export interface ManagedFrontmatterEvaluation {
  readonly values: readonly EvaluatedFrontmatterField[];
  readonly keys: readonly string[];
  readonly errors: readonly ManagedFrontmatterEvaluationError[];
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

export function compileManagedFrontmatterEntries(
  entries: readonly ManagedFrontmatterEntry[],
  options: CompileFrontmatterOptions,
): CompiledManagedFrontmatter {
  const compiled: CompiledManagedFrontmatterEntry[] = [];
  const inertKeys: string[] = [];
  for (const [index, entry] of entries.entries()) {
    const position = index + 1;
    if ("js" in entry && !options.javascript) {
      inertKeys.push(entry.key ?? `entry #${position}`);
      continue;
    }

    if (entry.key === undefined && "js" in entry) {
      const evaluator = toEvaluator(entry.js);
      compiled.push({
        key: undefined,
        position,
        merge: entry.merge,
        fn: (zt) => {
          const value = evaluator(zt, basename);
          assertFrontmatterSpreadOutput(value, position);
          return value;
        },
      });
      continue;
    }
    if (entry.key === undefined && "value" in entry) {
      compiled.push({
        key: undefined,
        position,
        merge: entry.merge,
        fn: (zt, operationTimestamp) =>
          renderJsonEFrontmatterValue(entry.value, {
            position,
            zt,
            operationTimestamp,
          }),
      });
      continue;
    }

    let fn: ManagedFrontmatterEvaluator;
    if ("expr" in entry) {
      const evaluator = toLiquidEvaluator(entry.expr, options.liquid);
      fn = (zt) => evaluator(zt, basename);
    } else if ("js" in entry) {
      const evaluator = toEvaluator(entry.js);
      fn = (zt) => evaluator(zt, basename);
    } else {
      fn = (zt, operationTimestamp) =>
        renderJsonEFrontmatterValue(entry.value, {
          key: entry.key,
          position,
          zt,
          operationTimestamp,
        });
    }
    if (entry.key !== undefined) {
      compiled.push({ key: entry.key, position, merge: entry.merge, fn });
    }
  }
  return { compiled, inertKeys };
}

export function evalManagedFrontmatterEntries(
  entries: readonly CompiledManagedFrontmatterEntry[],
  zt: object,
  operationTimestamp: Temporal.Instant,
): ManagedFrontmatterEvaluation {
  const values: EvaluatedFrontmatterField[] = [];
  const keys = new Set<string>();
  const errors: ManagedFrontmatterEvaluationError[] = [];
  for (const entry of entries) {
    try {
      if (entry.key === undefined) {
        const value = entry.fn(zt, operationTimestamp);
        if (value === FRONTMATTER_ABSENT) continue;
        for (const [key, generated] of Object.entries(value)) {
          values.push({
            key,
            merge: entry.merge,
            value: generated,
            position: entry.position,
          });
          keys.add(key);
        }
        continue;
      }
      const value = entry.fn(zt, operationTimestamp);
      if (value !== undefined && value !== FRONTMATTER_ABSENT) {
        assertFrontmatterOutputDomain(value);
        keys.add(entry.key);
      }
      values.push({
        key: entry.key,
        merge: entry.merge,
        value,
        position: entry.position,
      });
    } catch (cause) {
      const error =
        cause instanceof ManagedFrontmatterError
          ? cause
          : new ManagedFrontmatterError(
              entry,
              `failed evaluation: ${cause instanceof Error ? cause.message : String(cause)}`,
              { cause },
            );
      const key =
        entry.key ??
        (error.key === undefined
          ? `entry #${entry.position}`
          : `'${error.key}' (entry #${entry.position})`);
      errors.push({ key, error });
    }
  }
  return { values, keys: [...keys], errors };
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
  const fm: Record<string, unknown> = Object.create(null);
  for (const field of fields) {
    try {
      const value = field.fn(zt, basename);
      if (value !== undefined) defineFrontmatterValue(fm, field.key, value);
    } catch (error) {
      onError?.(field.key, error);
    }
  }
  return fm;
}

/** Serialize selected keys first, preserving their explicit order. */
export function stringifyFrontmatterInOrder(
  values: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string {
  const ordered = new Map<string, unknown>();
  for (const key of keys) {
    if (Object.hasOwn(values, key)) ordered.set(key, values[key]);
  }
  for (const key of Object.keys(values)) {
    if (!ordered.has(key)) ordered.set(key, values[key]);
  }
  return stringifyYaml(ordered);
}

function defineFrontmatterValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export { basename };
export type { FrontmatterField, FrontmatterLanguage } from "./constants";
