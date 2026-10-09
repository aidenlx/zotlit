import type { ItemQueryFault } from "./fault";
import { fieldDefinition } from "./fields";
import type {
  FieldDefinition,
  FieldNeeds,
  QueryItem,
  ValueShape,
} from "./fields";
import { parseProjectionPath } from "./projection-path";
import type { PathSegment } from "./projection-path";
import type { ProjectionValue } from "./request";

/** A validated Projection Path. */
export interface PlannedPath<Item = QueryItem, Needs = FieldNeeds> {
  /** The path as the caller wrote it: the key of the value in a Query Row. */
  readonly text: string;
  readonly field: FieldDefinition<Item, Needs>;
  /** The segments after the field name. */
  readonly rest: readonly PathSegment[];
  readonly needs: Needs;
  /** The custom field the path names, checked against the source later. */
  readonly customField: string | null;
}

export type PathProblem = Extract<
  ItemQueryFault,
  { kind: "plain" | "unknown" }
>;

/** The field that the leading segments of a path name, and the segments after it. */
export type PathResolver<Item = QueryItem, Needs = FieldNeeds> = (
  segments: readonly PathSegment[],
) =>
  | {
      readonly field: FieldDefinition<Item, Needs>;
      readonly rest: readonly PathSegment[];
    }
  | undefined;

/** The Item Query resolver: the first segment names a field of the registry. */
export const resolveItemPath: PathResolver = ([root, ...rest]) => {
  const field = typeof root === "string" ? fieldDefinition(root) : undefined;
  return field && { field, rest };
};

/** Check a Projection Path against the field registry of its dataset. */
export function planPath<Item = QueryItem, Needs = FieldNeeds>(
  text: string,
  resolve: PathResolver<Item, Needs>,
): PlannedPath<Item, Needs> | PathProblem {
  const parsed = parseProjectionPath(text);
  if (!parsed.ok) {
    return {
      kind: "plain",
      code: "invalid-path",
      action:
        'Write the path in the template accessor grammar, such as date.year or custom["review.status"].',
      at: { from: 0, to: text.length },
      message: `"${text}" is not a valid Projection Path. ${parsed.message}`,
    };
  }
  const resolved = resolve(parsed.segments);
  if (!resolved) {
    return {
      kind: "unknown",
      role: "projection-path",
      name: text,
      at: { from: 0, to: text.length },
    };
  }
  const { field, rest } = resolved;
  let shape: ValueShape = field.shape;
  let customField: string | null = null;
  for (const [index, segment] of rest.entries()) {
    const next = step(shape, segment);
    if (!next) {
      return {
        kind: "unknown",
        role: "projection-path",
        name: text,
        at: { from: 0, to: text.length },
      };
    }
    if (shape.kind === "custom-fields" && index === 0) {
      customField = segment as string;
    }
    shape = next;
  }
  return { text, field, rest, needs: field.needs(rest), customField };
}

function step(shape: ValueShape, segment: PathSegment): ValueShape | null {
  switch (shape.kind) {
    case "scalar":
    case "json":
      return null;
    case "object":
      return typeof segment === "string" && Object.hasOwn(shape.keys, segment)
        ? shape.keys[segment]!
        : null;
    case "list":
      return typeof segment === "number" ? shape.element : null;
    case "custom-fields":
      return typeof segment === "string" ? shape.value : null;
  }
}

/**
 * The value of a planned path for one Item. A missing key or array element is
 * null; array access does not vectorize.
 */
export function readPath<Item>(
  path: PlannedPath<Item, unknown>,
  item: Item,
): ProjectionValue {
  let value = path.field.read(item);
  for (const segment of path.rest) {
    if (value === null || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      value = typeof segment === "number" ? (value[segment] ?? null) : null;
    } else if (typeof segment === "string" && Object.hasOwn(value, segment)) {
      value = (value as Record<string, ProjectionValue>)[segment] ?? null;
    } else {
      return null;
    }
  }
  return value;
}
