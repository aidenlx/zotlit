import type { FrontmatterMergeStrategy } from "./constants";

/**
 * Generated-field state that deletes an existing key under `replace` and
 * preserves it under `append` or `keep`. A create operation always omits it.
 */
export const FRONTMATTER_ABSENT = Symbol("frontmatter absent");

export interface FrontmatterFieldMergeSpec {
  key: string;
  merge: FrontmatterMergeStrategy;
}

export interface EvaluatedFrontmatterField extends FrontmatterFieldMergeSpec {
  readonly value: unknown;
  readonly position?: number;
}

export interface FrontmatterMergeConflict {
  reason: "shape-mismatch";
  position?: number;
  recovery?: string;
}

export type FrontmatterMergeConflictHandler = (
  key: string,
  detail: FrontmatterMergeConflict,
) => void;

export interface MergeFrontmatterOptions {
  /** Existing frontmatter values that strategies read against. @default {} */
  current?: Readonly<Record<string, unknown>>;
  onConflict?: FrontmatterMergeConflictHandler;
}

export function mergeFrontmatterFields(
  fields: readonly FrontmatterFieldMergeSpec[],
  evaluated: Record<string, unknown>,
  options: MergeFrontmatterOptions = {},
): Record<string, unknown> {
  return mergeManagedFrontmatterEntries(
    fields
      .filter(({ key }) => Object.hasOwn(evaluated, key))
      .map((field) => ({ ...field, value: evaluated[field.key] })),
    options,
  );
}

/** Resolve each contribution against the note overlaid by the pending patch. */
export function mergeManagedFrontmatterEntries(
  fields: readonly EvaluatedFrontmatterField[],
  { current = {}, onConflict }: MergeFrontmatterOptions = {},
): Record<string, unknown> {
  const patch: Record<string, unknown> = Object.create(null);

  const setPatch = (key: string, value: unknown): void => {
    Object.defineProperty(patch, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  };

  for (const field of fields) {
    const generated = field.value;
    if (generated === undefined) continue;
    const pending = Object.hasOwn(patch, field.key)
      ? patch[field.key]
      : Object.hasOwn(current, field.key)
        ? current[field.key]
        : undefined;
    const existing = pending === FRONTMATTER_ABSENT ? undefined : pending;
    if (generated === FRONTMATTER_ABSENT) {
      if (
        field.merge === "replace" &&
        (Object.hasOwn(patch, field.key) || Object.hasOwn(current, field.key))
      ) {
        setPatch(field.key, FRONTMATTER_ABSENT);
      }
      continue;
    }
    switch (field.merge) {
      case "replace":
        setPatch(field.key, generated);
        break;
      case "append":
        if (Array.isArray(existing) && Array.isArray(generated)) {
          setPatch(field.key, appendDistinct(existing, generated));
        } else if (isBlank(existing)) {
          setPatch(field.key, generated);
        } else {
          onConflict?.(field.key, {
            reason: "shape-mismatch",
            ...(field.position === undefined
              ? {}
              : {
                  position: field.position,
                  recovery: `Use arrays for field '${field.key}' in entry #${field.position}, or use replace.`,
                }),
          });
        }
        break;
      case "keep":
        if (isBlank(existing)) setPatch(field.key, generated);
        break;
    }
  }

  return patch;
}

/**
 * Keep `existing` verbatim (including any pre-existing duplicates) and append
 * only generated items not already present. Unlike a plain union/distinct, this
 * never reorders or collapses what the user already wrote.
 */
function appendDistinct(
  existing: readonly unknown[],
  generated: readonly unknown[],
): unknown[] {
  const seen = new Set(existing);
  const result = [...existing];
  for (const item of generated) {
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function isBlank(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    return (
      (proto === Object.prototype || proto === null) &&
      Object.keys(value).length === 0
    );
  }
  return false;
}
