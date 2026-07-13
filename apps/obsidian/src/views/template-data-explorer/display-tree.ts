// Pure value-walker mapping an anchor root object + expansion set to typed display nodes.

export type PathSegment = string | number;

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

/** Inert "not imported" node, standing in for a helper that would otherwise queue a vault write. */
export interface PlaceholderNode extends DisplayNodeBase {
  readonly kind: "placeholder";
  readonly reason: string;
}

export type DisplayNode = ValueNode | HelperNode | PlaceholderNode;

export interface BuildDisplayTreeOptions {
  readonly expanded: ReadonlySet<string>;
}

const INERT_PLACEHOLDER = Symbol("zotlit-inert-placeholder");

/** Brand `fn` in place as an inert placeholder carrying `reason` (via `defineProperty` on the passed function), so {@link classifyValue} emits a {@link PlaceholderNode} instead of a {@link HelperNode}. Returns the same reference. */
export function markInertPlaceholder<T extends (...args: never[]) => unknown>(
  fn: T,
  reason: string,
): T {
  Object.defineProperty(fn, INERT_PLACEHOLDER, {
    value: reason,
    enumerable: false,
  });
  return fn;
}

/** Read back the reason attached by {@link markInertPlaceholder}, if any. */
export function inertPlaceholderReason(value: unknown): string | undefined {
  if (typeof value !== "function") return undefined;
  return (value as unknown as Record<symbol, unknown>)[INERT_PLACEHOLDER] as
    | string
    | undefined;
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
  return buildChildren(root, [], options.expanded);
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Render a data path. With no rootAlias, used as the expansion/React key; the
 * "zt" alias produces the copy-path both engines share (both bind data to `zt`).
 * Numeric segments render as [i]; identifier string segments as .name (or
 * bare when first with no root); other string segments (e.g. Zotero custom
 * field keys with dashes or spaces) as [JSON.stringify(segment)] so the
 * copied path stays paste-correct in both Liquid and Eta/JS.
 */
export function formatPath(
  segments: readonly PathSegment[],
  rootAlias?: string,
): string {
  let out = rootAlias ?? "";
  for (const seg of segments) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
    } else if (IDENTIFIER_RE.test(seg)) {
      out += out ? `.${seg}` : seg;
    } else {
      out += `[${JSON.stringify(seg)}]`;
    }
  }
  return out;
}

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
  expanded: ReadonlySet<string>,
): DisplayNode[] {
  return entriesOf(container).map((entry) =>
    buildNode(entry, parentPath, expanded),
  );
}

function buildNode(
  entry: Entry,
  parentPath: readonly PathSegment[],
  expanded: ReadonlySet<string>,
): DisplayNode {
  const path = [...parentPath, entry.segment];
  const key = formatPath(path);
  const label = String(entry.segment);
  const isExpanded = expanded.has(key);

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
  return classifyValue(value, { path, key, label }, expanded);
}

function classifyValue(
  value: unknown,
  { path, key, label }: DisplayNodeBase,
  expanded: ReadonlySet<string>,
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
  const expandable = size > 0;
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

  if (expanded.has(key) && size > 0) {
    return { ...node, children: buildChildren(container, path, expanded) };
  }

  return node;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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

/**
 * Collapsed preview drawn from a container's own `toString` — the non-enumerable
 * renderer the template context attaches to creators, dates, tags, and
 * collections (always an own property, via `defineToString`). `undefined` for a
 * plain record with only the inherited toString, so it falls back to its size hint.
 */
function containerPreview(value: object): string | undefined {
  if (!Object.hasOwn(value, "toString")) return undefined;
  // oxlint-disable-next-line no-base-to-string -- guarded above: value defines its own toString.
  const rendered = String(value).replaceAll(/\s+/g, " ").trim();
  if (!rendered || rendered === "[object Object]") return undefined;
  return rendered.length > PREVIEW_MAX_LENGTH
    ? `${rendered.slice(0, PREVIEW_MAX_LENGTH)}…`
    : rendered;
}

/** Labels of the template contract's `TemplateLink`/`FallibleTemplateLink` helpers, which all share the `(alias?, subpath?)` signature. */
const LINK_HELPER_SIGNATURE_HINTS: ReadonlySet<string> = new Set([
  "noteLink",
  "fileLink",
  "imgLink",
]);

function describeSignature(fn: Function, label: string): string {
  if (LINK_HELPER_SIGNATURE_HINTS.has(label)) return "ƒ(alias?, subpath?)";
  const n = fn.length;
  return n === 0 ? "ƒ()" : `ƒ(${Array(n).fill("·").join(", ")})`;
}

/** Evaluate a helper with no arguments; `null` on throw, or a null/undefined result. */
function evaluateHelper(fn: (...args: unknown[]) => unknown): string | null {
  try {
    const result = fn();
    // oxlint-disable-next-line no-base-to-string -- helpers may legitimately return non-string values (e.g. numbers); render whatever they produce.
    return result == null ? null : String(result);
  } catch {
    return null;
  }
}

/**
 * Render a node's current value for the copy-value menu action.
 * `null` means "no copy-value entry" (unevaluated getter, or placeholder).
 */
export function copyValue(node: DisplayNode): string | null {
  if (node.kind === "placeholder") return null;
  if (node.kind === "helper") return node.evaluated;

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
      // oxlint-disable-next-line no-base-to-string -- opaque values render via their own toString (e.g. Temporal, Date).
      return String(node.value);
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

/**
 * Walks the raw root exhaustively, keeping only nodes whose label or
 * stringified primitive value contains `query`, plus their auto-expanded
 * ancestor chains.
 */
export interface BuildFilteredDisplayTreeOptions {
  /** Keys (see {@link formatPath}) of containers to render without children, even when they have filtered matches. */
  readonly collapsed?: ReadonlySet<string>;
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
    lowerQuery: query.toLowerCase(),
    matchedKeys: new Set(),
    activeContainers: new WeakSet(),
    collapsed: options?.collapsed ?? new Set(),
  };
  const nodes = filterChildren(root, [], ctx);
  return { nodes, matchedKeys: ctx.matchedKeys };
}

interface FilterContext {
  readonly lowerQuery: string;
  readonly matchedKeys: Set<string>;
  readonly activeContainers: WeakSet<object>;
  readonly collapsed: ReadonlySet<string>;
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
  const labelMatches = label.toLowerCase().includes(ctx.lowerQuery);
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
    return classifyValue(value, nodeBase, new Set());
  }

  const valueType = valueTypeOf(value);

  if (valueType !== "array" && valueType !== "object") {
    const valueMatches = stringifyPrimitive(value)
      .toLowerCase()
      .includes(ctx.lowerQuery);
    if (!labelMatches && !valueMatches) return null;
    ctx.matchedKeys.add(key);
    return classifyValue(value, nodeBase, new Set());
  }

  if (valueType === "object" && !isPlainObject(value as object)) {
    if (!labelMatches) return null;
    ctx.matchedKeys.add(key);
    return classifyValue(value, nodeBase, new Set());
  }

  const container = value as object;
  const size = Array.isArray(container)
    ? container.length
    : Object.keys(container).length;

  const children = size > 0 ? filterChildren(container, path, ctx) : [];
  if (!labelMatches && children.length === 0) return null;
  if (labelMatches) ctx.matchedKeys.add(key);

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

function stringifyPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return String(value as string | number | boolean);
}
