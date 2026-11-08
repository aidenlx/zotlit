// Pure value-walker mapping an anchor root object + expansion set to typed display nodes.

import { formatAccessorPath, memberAccessor } from "./accessor-path";
import type { TemplatePathSegment } from "./accessor-path";
import { inertPlaceholderReason } from "./inert-placeholder";
import { evaluateHelper, isPlainObject, readList } from "./list-items";
import { coerceToString } from "./string-coercion";

export type PathSegment = TemplatePathSegment;

export type DisplayValueType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "undefined"
  | "array"
  | "object"
  | "opaque"
  | "getter";

interface DisplayNodeBase {
  /** Data path from the anchor root, e.g. ["annotations", 0, "comment"]. */
  readonly path: readonly PathSegment[];
  /** Expansion + React key; equals formatPath(path) with no root alias. */
  readonly key: string;
  /** Row label: the property name, or the array index as a string. */
  readonly label: string;
}

export interface ValueNode extends DisplayNodeBase {
  readonly kind: "value";
  readonly valueType: DisplayValueType;
  /** Raw primitive value, or the container reference; undefined for an unevaluated getter. */
  readonly value: unknown;
  /** True for a non-empty container, or an unevaluated ("getter") node. */
  readonly expandable: boolean;
  /** Entry count for a container; omitted otherwise. */
  readonly size?: number;
  /** Collapsed one-line preview from the container's own `toString` (creator, date, tag, collection); omitted when it carries only the default Object/Array toString. */
  readonly preview?: string;
  /** Present only when this node is expanded. Absence = collapsed. */
  readonly children?: readonly DisplayNode[];
}

export interface HelperNode extends DisplayNodeBase {
  readonly kind: "helper";
  /** Signature hint, e.g. "ƒ()", "ƒ(·, ·)", or "ƒ(alias?, subpath?)" for a known link helper. */
  readonly signatureHint: string;
  /** The helper's zero-argument rendering; `null` if it returns null/undefined or throws. */
  readonly evaluated: string | null;
}

/**
 * One property that a list's items have, holding that property's value for
 * every item: the shape view of a list of records, in place of one node for
 * each index. Its `path` is the list's path followed by the property; its
 * `key` marks the step over the items, as in `authors[].family`.
 */
export interface ListPropertyNode extends DisplayNodeBase {
  readonly kind: "list-property";
  /** Path of the list whose items carry the property. */
  readonly list: readonly PathSegment[];
  readonly property: string;
  /** Each item's value as text, in item order; an item with no value is left out. */
  readonly values: readonly string[];
  /** The values in one compact line. */
  readonly preview: string;
}

/** Inert "not imported" node, standing in for a helper that would otherwise queue a vault write. */
export interface PlaceholderNode extends DisplayNodeBase {
  readonly kind: "placeholder";
  readonly reason: string;
}

export type DisplayNode =
  | ValueNode
  | HelperNode
  | PlaceholderNode
  | ListPropertyNode;

/**
 * How a list opens: `items` gives one node for each index; `shape` gives a
 * list of records one {@link ListPropertyNode} for each property its items
 * have, and a list of plain values no sub-nodes.
 */
export type ListLayout = "items" | "shape";

export interface BuildDisplayTreeOptions {
  readonly expanded: ReadonlySet<string>;
  /** @default "items" */
  readonly lists?: ListLayout;
}

interface Walk {
  readonly expanded: ReadonlySet<string>;
  readonly lists: ListLayout;
}

/** `null` when `annotationKey` matches no annotation (e.g. the annotation vanished since the tree was last built). */
export function findAnnotationRoot<T extends { key: string }>(
  context: { annotations: readonly T[] },
  annotationKey: string,
): T | null {
  return context.annotations.find((a) => a.key === annotationKey) ?? null;
}

/** `null` unless `path` is exactly `["annotations", i]` with `i` a valid index into `context.annotations`. */
export function annotationKeyAtPath(
  context: { annotations: readonly { key: string }[] },
  path: readonly PathSegment[],
): string | null {
  if (path.length !== 2 || path[0] !== "annotations") return null;
  const index = path[1];
  if (typeof index !== "number") return null;
  return context.annotations[index]?.key ?? null;
}

/** Top-level field nodes for the anchor root (its own children, no synthetic root row). */
export function buildDisplayTree(
  root: object,
  options: BuildDisplayTreeOptions,
): readonly DisplayNode[] {
  return buildChildren(root, [], {
    expanded: options.expanded,
    lists: options.lists ?? "items",
  });
}

/** Format a display path, optionally rooted at the Template alias. */
export const formatPath = formatAccessorPath;

interface Entry {
  readonly segment: PathSegment;
  readonly isGetter: boolean;
  readonly read: () => unknown;
}

function entriesOf(container: object): Entry[] {
  return Array.isArray(container)
    ? container.map((value, i) => ({
        segment: i,
        isGetter: false,
        read: () => value,
      }))
    : Object.keys(container)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => {
          const desc = Object.getOwnPropertyDescriptor(container, key)!;
          return {
            segment: key,
            isGetter: !!desc.get,
            read: desc.get ? () => desc.get!.call(container) : () => desc.value,
          };
        });
}

function buildChildren(
  container: object,
  parentPath: readonly PathSegment[],
  walk: Walk,
): DisplayNode[] {
  if (walk.lists === "shape" && Array.isArray(container))
    return listProperties(container, parentPath);
  return entriesOf(container).map((entry) =>
    buildNode(entry, parentPath, walk),
  );
}

function buildNode(
  entry: Entry,
  parentPath: readonly PathSegment[],
  walk: Walk,
): DisplayNode {
  const path = [...parentPath, entry.segment];
  const key = formatPath(path);
  const label = String(entry.segment);
  const isExpanded = walk.expanded.has(key);

  if (entry.isGetter && !isExpanded) {
    return {
      kind: "value",
      path,
      key,
      label,
      valueType: "getter",
      value: undefined,
      expandable: true,
    };
  }

  const value = entry.read();
  return classifyValue(value, { path, key, label }, walk);
}

function classifyValue(
  value: unknown,
  { path, key, label }: DisplayNodeBase,
  walk: Walk,
): DisplayNode {
  if (typeof value === "function") {
    const reason = inertPlaceholderReason(value);
    if (reason !== undefined) {
      return { kind: "placeholder", path, key, label, reason };
    }

    const fn = value as (...args: unknown[]) => unknown;
    return {
      kind: "helper",
      path,
      key,
      label,
      signatureHint: describeSignature(fn, label),
      evaluated: evaluateHelper(fn),
    };
  }

  const valueType = valueTypeOf(value);

  if (valueType !== "array" && valueType !== "object") {
    return {
      kind: "value",
      path,
      key,
      label,
      valueType,
      value,
      expandable: false,
    };
  }

  if (valueType === "object" && !isPlainObject(value as object)) {
    // non-plain object (Temporal, Date, class instance): show its string form, don't fabricate empty children
    return {
      kind: "value",
      path,
      key,
      label,
      valueType: "opaque",
      value,
      expandable: false,
    };
  }

  const container = value as object;
  const size = Array.isArray(container)
    ? container.length
    : Object.keys(container).length;
  const expandable =
    walk.lists === "shape" && Array.isArray(container)
      ? readList(container).properties.length > 0
      : size > 0;
  const preview = containerPreview(container);

  const node: ValueNode = {
    kind: "value",
    path,
    key,
    label,
    valueType,
    value,
    expandable,
    size,
    ...(preview !== undefined ? { preview } : {}),
  };

  if (walk.expanded.has(key) && expandable) {
    return { ...node, children: buildChildren(container, path, walk) };
  }

  return node;
}

function valueTypeOf(value: unknown): DisplayValueType {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return t;
  return "object";
}

/** Keeps a collapsed preview to one compact line (annotation excerpts / titles can run long or multi-line). */
const PREVIEW_MAX_LENGTH = 80;

/** The one compact line a preview shows: whitespace collapsed, cut at {@link PREVIEW_MAX_LENGTH} with an ellipsis. */
export function previewLine(text: string): string {
  const line = text.replaceAll(/\s+/g, " ").trim();
  return line.length > PREVIEW_MAX_LENGTH
    ? `${line.slice(0, PREVIEW_MAX_LENGTH)}…`
    : line;
}

/**
 * Collapsed preview drawn from a container's own `toString` — the non-enumerable
 * renderer the template context attaches to creators, dates, tags, and
 * collections (always an own property, via `defineToString`). `undefined` for a
 * plain record with only the inherited toString, so it falls back to its size hint.
 */
function containerPreview(value: object): string | undefined {
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    return previewLine(readList(value).lines.join(", "));
  }
  if (!Object.hasOwn(value, "toString")) return undefined;
  const rendered = previewLine(coerceToString(value));
  if (!rendered || rendered === "[object Object]") return undefined;
  return rendered;
}

/** The shape view of a list: one node for each property its records have. */
function listProperties(
  list: readonly unknown[],
  listPath: readonly PathSegment[],
): ListPropertyNode[] {
  const listKey = formatPath(listPath);
  return readList(list).properties.map(({ name, values }) => ({
    kind: "list-property",
    path: [...listPath, name],
    // `[]` marks the step over every item, as in `authors[].family`.
    key: `${listKey}[]${memberAccessor(name)}`,
    label: name,
    list: listPath,
    property: name,
    values,
    preview: previewLine(values.join(", ")),
  }));
}

/** Labels of the template contract's `TemplateLink`/`FallibleTemplateLink` helpers, which all share the `(alias?, subpath?)` signature. */
const LINK_HELPER_SIGNATURE_HINTS: ReadonlySet<string> = new Set([
  "noteLink",
  "fileLink",
  "imgLink",
]);

function describeSignature(
  fn: (...args: never[]) => unknown,
  label: string,
): string {
  if (LINK_HELPER_SIGNATURE_HINTS.has(label)) return "ƒ(alias?, subpath?)";
  const n = fn.length;
  return n === 0 ? "ƒ()" : `ƒ(${Array(n).fill("·").join(", ")})`;
}

/**
 * Render a node's current value for the copy-value menu action.
 * `null` means "no copy-value entry" (unevaluated getter, or placeholder).
 */
export function copyValue(node: DisplayNode): string | null {
  if (node.kind === "placeholder") return null;
  if (node.kind === "helper") return node.evaluated;
  if (node.kind === "list-property") return node.values.join("\n");

  switch (node.valueType) {
    case "getter":
      return null;
    case "string":
      return node.value as string;
    case "number":
    case "boolean":
      return String(node.value);
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    case "opaque":
      return coerceToString(node.value);
    case "array":
    case "object":
      return stringifyContainer(node.value);
  }
}

/** JSON-stringify a container, dropping circular re-entries the template context's lazy back-references can introduce. */
function stringifyContainer(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    const seen = new WeakSet<object>();
    return JSON.stringify(
      value,
      (_key, v) => {
        if (typeof v !== "object" || v === null) return v;
        if (seen.has(v)) return undefined;
        seen.add(v);
        return v;
      },
      2,
    );
  }
}

/** What a search reads of one field. */
export interface SearchedField {
  /** The field's key, or the property of a list's items. */
  readonly label: string;
  /** The name the reader sees for it, where it has one. */
  readonly alias?: string;
  readonly path: readonly PathSegment[];
  /** Its values as text; a value the search may not read is left out. */
  readonly values?: readonly string[];
}

/**
 * The one search rule over fields: a field matches when its key, the name
 * the reader sees, its template path (`zt.authors.family`) or one of its
 * values contains `query`, in any case. A path matches the field the query
 * reaches into, not the fields inside it.
 */
export function fieldMatches(query: string, field: SearchedField): boolean {
  const needle = query.toLowerCase();
  const has = (text: string) => text.toLowerCase().includes(needle);
  return (
    [field.label, field.alias ?? "", ...(field.values ?? [])].some(has) ||
    // A path the query reaches only up to the parent's names the parent.
    (has(formatPath(field.path, "zt")) &&
      !has(formatPath(field.path.slice(0, -1), "zt")))
  );
}

/**
 * Walks the raw root exhaustively, keeping only nodes that match `query` by
 * {@link fieldMatches}, plus their auto-expanded ancestor chains.
 */
export interface BuildFilteredDisplayTreeOptions {
  /** Keys (see {@link formatPath}) of containers to render without children, even when they have filtered matches. */
  readonly collapsed?: ReadonlySet<string>;
  /** Extra searchable text per key, such as the reader-facing name of a top-level field. */
  readonly aliases?: ReadonlyMap<string, string>;
  /** See {@link ListLayout}. @default "items" */
  readonly lists?: ListLayout;
}

export function buildFilteredDisplayTree(
  root: object,
  query: string,
  options?: BuildFilteredDisplayTreeOptions,
): {
  nodes: readonly DisplayNode[];
  matchedKeys: ReadonlySet<string>;
} {
  const ctx: FilterContext = {
    query,
    matchedKeys: new Set(),
    activeContainers: new WeakSet(),
    collapsed: options?.collapsed ?? new Set(),
    aliases: options?.aliases ?? new Map(),
    lists: options?.lists ?? "items",
  };
  const nodes = filterChildren(root, [], ctx);
  return { nodes, matchedKeys: ctx.matchedKeys };
}

interface FilterContext {
  readonly query: string;
  readonly matchedKeys: Set<string>;
  readonly activeContainers: WeakSet<object>;
  readonly collapsed: ReadonlySet<string>;
  readonly aliases: ReadonlyMap<string, string>;
  readonly lists: ListLayout;
}

function filterChildren(
  container: object,
  parentPath: readonly PathSegment[],
  ctx: FilterContext,
): DisplayNode[] {
  if (ctx.activeContainers.has(container)) return [];
  ctx.activeContainers.add(container);

  const results: DisplayNode[] = [];
  for (const entry of entriesOf(container)) {
    const node = filterNode(entry, parentPath, ctx);
    if (node !== null) results.push(node);
  }
  ctx.activeContainers.delete(container);
  return results;
}

function filterNode(
  entry: Entry,
  parentPath: readonly PathSegment[],
  ctx: FilterContext,
): DisplayNode | null {
  const path = [...parentPath, entry.segment];
  const key = formatPath(path);
  const label = String(entry.segment);
  const alias = ctx.aliases.get(key);
  const field: SearchedField =
    alias === undefined ? { label, path } : { label, alias, path };
  const labelMatches = fieldMatches(ctx.query, field);
  const nodeBase = { path, key, label };

  if (entry.isGetter && labelMatches) {
    ctx.matchedKeys.add(key);
    return {
      kind: "value",
      ...nodeBase,
      valueType: "getter",
      value: undefined,
      expandable: true,
    };
  }

  const value = entry.read();

  if (typeof value === "function") {
    if (!labelMatches) return null;
    ctx.matchedKeys.add(key);
    return classifyValue(value, nodeBase, {
      expanded: new Set(),
      lists: ctx.lists,
    });
  }

  const valueType = valueTypeOf(value);

  if (valueType !== "array" && valueType !== "object") {
    const valueMatches = fieldMatches(ctx.query, {
      ...field,
      values: [stringifyPrimitive(value)],
    });
    if (!valueMatches) return null;
    ctx.matchedKeys.add(key);
    return classifyValue(value, nodeBase, {
      expanded: new Set(),
      lists: ctx.lists,
    });
  }

  if (valueType === "object" && !isPlainObject(value as object)) {
    if (!labelMatches) return null;
    ctx.matchedKeys.add(key);
    return classifyValue(value, nodeBase, {
      expanded: new Set(),
      lists: ctx.lists,
    });
  }

  const container = value as object;
  const size = Array.isArray(container)
    ? container.length
    : Object.keys(container).length;

  const shape = ctx.lists === "shape" && Array.isArray(container);
  const children = shape
    ? filterListProperties(container as unknown[], path, ctx)
    : size > 0
      ? filterChildren(container, path, ctx)
      : [];
  // A list of plain values has no sub-nodes, so it matches on its items.
  const reading = shape ? readList(container as unknown[]) : null;
  const itemsMatch =
    reading !== null &&
    reading.properties.length === 0 &&
    fieldMatches(ctx.query, { ...field, values: reading.lines });
  if (!labelMatches && !itemsMatch && children.length === 0) return null;
  if (labelMatches || itemsMatch) ctx.matchedKeys.add(key);

  const preview = containerPreview(container);
  const expandable = children.length > 0;
  const isCollapsed = expandable && ctx.collapsed.has(key);
  return {
    kind: "value",
    ...nodeBase,
    valueType,
    value,
    expandable,
    size,
    ...(preview !== undefined ? { preview } : {}),
    ...(expandable && !isCollapsed ? { children } : {}),
  };
}

/** The list's properties that match the query by name, path or any item's value. */
function filterListProperties(
  list: readonly unknown[],
  listPath: readonly PathSegment[],
  ctx: FilterContext,
): ListPropertyNode[] {
  return listProperties(list, listPath).filter((node) => {
    const alias = ctx.aliases.get(node.key);
    const matches = fieldMatches(ctx.query, {
      label: node.label,
      ...(alias !== undefined && { alias }),
      path: node.path,
      values: node.values,
    });
    if (matches) ctx.matchedKeys.add(node.key);
    return matches;
  });
}

function stringifyPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return String(value);
}
