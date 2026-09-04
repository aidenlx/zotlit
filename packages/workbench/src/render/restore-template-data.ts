// Pure restoration of the JSON-safe Template-data graph used by browser renders.

import { formatAccessorPath } from "@/explorer/accessor-path";
import type { TemplatePathSegment } from "@/explorer/accessor-path";
import type { SnapshotRootDescriptors } from "@/snapshot/descriptors";
import { formatWikiLink } from "@/snapshot/wiki-link";

export class SnapshotRestorationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotRestorationError";
  }
}

export function restoreTemplateData(
  serialized: Record<string, unknown>,
  descriptors: SnapshotRootDescriptors,
): Record<string, unknown> {
  const root = restoreSerializedValue(serialized) as Record<string, unknown>;
  for (const descriptor of descriptors.temporalValues) {
    restoreTemporalValue(root, descriptor);
  }
  for (const descriptor of descriptors.graphReferences) {
    restoreGraphReference(root, descriptor);
  }

  const restoredCoercions = new WeakSet<object>();
  for (const descriptor of descriptors.stringCoercions) {
    defineStringCoercion(root, descriptor, restoredCoercions);
  }
  return root;
}

function restoreSerializedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restoreSerializedValue);
  if (!value || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  if (typeof source.$inert === "string") return linkHelper(null);
  if (typeof source.$helper === "string") {
    return linkHelper(restoreSerializedValue(source.value));
  }
  return Object.fromEntries(
    Object.entries(source).map(([name, entry]) => [
      name,
      restoreSerializedValue(entry),
    ]),
  );
}

function restoreTemporalValue(
  root: Record<string, unknown>,
  descriptor: SnapshotRootDescriptors["temporalValues"][number],
): void {
  const location = descriptorLocation(root, descriptor.path);
  if (typeof location.value !== "string") {
    throw descriptorError(descriptor.path, "must select a serialized string");
  }
  location.parent[location.key] = temporalFrom(descriptor.type, location.value);
}

function restoreGraphReference(
  root: Record<string, unknown>,
  descriptor: SnapshotRootDescriptors["graphReferences"][number],
): void {
  const location = descriptorLocation(root, descriptor.path);
  const marker = location.value as Record<string, unknown> | null;
  const expected = formatAccessorPath(descriptor.target, "zt");
  if (!marker || typeof marker !== "object" || marker.$ref !== expected) {
    throw descriptorError(
      descriptor.path,
      `must select the graph marker '${expected}'`,
    );
  }
  location.parent[location.key] = descriptorValue(root, descriptor.target);
}

function defineStringCoercion(
  root: Record<string, unknown>,
  descriptor: SnapshotRootDescriptors["stringCoercions"][number],
  restored: WeakSet<object>,
): void {
  const target = descriptorValue(root, descriptor.path);
  if (!target || typeof target !== "object") {
    throw descriptorError(descriptor.path, "must select an object");
  }
  if (restored.has(target)) return;
  restored.add(target);
  Object.defineProperty(target, "toString", {
    value: () => descriptor.value,
    enumerable: false,
  });
}

function temporalFrom(
  type: SnapshotRootDescriptors["temporalValues"][number]["type"],
  value: string,
): Temporal.Instant | Temporal.PlainDate | Temporal.PlainYearMonth {
  switch (type) {
    case "Temporal.Instant":
      return Temporal.Instant.from(value);
    case "Temporal.PlainDate":
      return Temporal.PlainDate.from(value);
    case "Temporal.PlainYearMonth":
      return Temporal.PlainYearMonth.from(value);
  }
}

function descriptorLocation(
  root: Record<string, unknown>,
  path: readonly TemplatePathSegment[],
): {
  parent: Record<string | number, unknown>;
  key: string | number;
  value: unknown;
} {
  if (path.length === 0) {
    throw descriptorError(path, "cannot replace the root");
  }
  const parentPath = path.slice(0, -1);
  const parent = descriptorValue(root, parentPath);
  const key = path.at(-1)!;
  if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key)) {
    throw descriptorError(path, "does not exist");
  }
  return {
    parent: parent as Record<string | number, unknown>,
    key,
    value: (parent as Record<string | number, unknown>)[key],
  };
}

function descriptorValue(
  root: Record<string, unknown>,
  path: readonly TemplatePathSegment[],
): unknown {
  let value: unknown = root;
  for (const segment of path) {
    if (!value || typeof value !== "object" || !Object.hasOwn(value, segment)) {
      throw descriptorError(path, "does not exist");
    }
    value = (value as Record<string | number, unknown>)[segment];
  }
  return value;
}

function descriptorError(
  path: readonly TemplatePathSegment[],
  detail: string,
): SnapshotRestorationError {
  return new SnapshotRestorationError(
    `Snapshot descriptor '${formatAccessorPath(path, "zt")}' ${detail}.`,
  );
}

function linkHelper(value: unknown): (...args: string[]) => string | null {
  const helper = (alias?: string, subpath?: string) =>
    renderLinkValue(value, alias, subpath);
  Object.defineProperty(helper, "toString", {
    value: () => String(helper() ?? ""),
  });
  return helper;
}

function renderLinkValue(
  value: unknown,
  alias?: string,
  subpath?: string,
): string | null {
  if (
    typeof value !== "string" ||
    !value.startsWith("[[") ||
    !value.endsWith("]]")
  ) {
    return null;
  }
  const inner = value.slice(2, -2);
  const aliasSeparator = inner.lastIndexOf("|");
  const targetWithSubpath =
    aliasSeparator === -1 ? inner : inner.slice(0, aliasSeparator);
  const defaultAlias =
    aliasSeparator === -1 ? undefined : inner.slice(aliasSeparator + 1);
  const subpathSeparator = targetWithSubpath.indexOf("#");
  const target =
    subpathSeparator === -1
      ? targetWithSubpath
      : targetWithSubpath.slice(0, subpathSeparator);
  const defaultSubpath =
    subpathSeparator === -1
      ? undefined
      : targetWithSubpath.slice(subpathSeparator + 1);
  return formatWikiLink(target, {
    alias: alias ?? defaultAlias,
    subpath: subpath ?? defaultSubpath,
  });
}
