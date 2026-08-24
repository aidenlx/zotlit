import type { FrontmatterMergeStrategy } from "./constants";

export interface FrontmatterFieldMergeSpec {
  key: string;
  merge: FrontmatterMergeStrategy;
}

export interface FrontmatterMergeConflict {
  reason: "shape-mismatch";
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
  { current = {}, onConflict }: MergeFrontmatterOptions = {},
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const field of fields) {
    if (!Object.hasOwn(evaluated, field.key)) continue;

    const generated = evaluated[field.key];
    const existing = current[field.key];
    switch (field.merge) {
      case "replace":
        patch[field.key] = generated;
        break;
      case "append":
        if (Array.isArray(existing) && Array.isArray(generated)) {
          patch[field.key] = appendDistinct(existing, generated);
        } else if (isBlank(existing)) {
          patch[field.key] = generated;
        } else {
          onConflict?.(field.key, { reason: "shape-mismatch" });
        }
        break;
      case "keep":
        if (isBlank(existing)) patch[field.key] = generated;
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
