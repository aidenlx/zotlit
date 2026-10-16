// Browser-safe descriptor contract and extraction for serialized Template data.

import type { TemplatePathSegment } from "#/explorer/accessor-path";

import type {
  SnapshotGraphReference,
  SnapshotRootDescriptors,
  SnapshotStringCoercion,
  SnapshotTemporalValue,
} from "./schema";

export type {
  SnapshotGraphReference,
  SnapshotRootDescriptors,
  SnapshotStringCoercion,
  SnapshotTemporalValue,
} from "./schema";

export function collectRootDescriptors(root: object): SnapshotRootDescriptors {
  const stringCoercions: SnapshotStringCoercion[] = [];
  const temporalValues: SnapshotTemporalValue[] = [];
  const graphReferences: SnapshotGraphReference[] = [];
  const active = new WeakMap<object, readonly TemplatePathSegment[]>();

  const visit = (
    value: unknown,
    path: readonly TemplatePathSegment[],
  ): void => {
    if (!value || typeof value !== "object") return;
    const target = active.get(value);
    if (target) {
      graphReferences.push({ path, target });
      return;
    }

    const temporalType = temporalTypeOf(value);
    if (temporalType) {
      temporalValues.push({ path, type: temporalType });
      return;
    }
    const toString = Object.getOwnPropertyDescriptor(value, "toString")?.value;
    if (typeof toString === "function") {
      const rendered = Reflect.apply(toString, value, []) as unknown;
      if (typeof rendered === "string") {
        stringCoercions.push({ path, value: rendered });
      }
    }

    active.set(value, path);
    try {
      if (Array.isArray(value)) {
        value.forEach((entry, index) => visit(entry, [...path, index]));
        return;
      }
      for (const key of Object.keys(value)) {
        visit((value as Record<string, unknown>)[key], [...path, key]);
      }
    } finally {
      active.delete(value);
    }
  };

  visit(root, []);
  return { stringCoercions, temporalValues, graphReferences };
}

function temporalTypeOf(value: object): SnapshotTemporalValue["type"] | null {
  if (value instanceof Temporal.Instant) return "Temporal.Instant";
  if (value instanceof Temporal.PlainDate) return "Temporal.PlainDate";
  if (value instanceof Temporal.PlainYearMonth)
    return "Temporal.PlainYearMonth";
  return null;
}
