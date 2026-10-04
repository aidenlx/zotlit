import { Effect } from "effect";

import { ItemQueryError } from "./error";
import { DEFAULT_FIELDS } from "./fields";
import { planPath } from "./projection";
import type { PlannedPath } from "./projection";

/**
 * The Target Library, resolved by the caller. `libraryID` is local to the
 * database copy; `groupID` is `null` for the personal Library.
 */
export interface TargetLibrary {
  readonly libraryID: number;
  readonly groupID: number | null;
}

export interface ItemQueryRequest {
  readonly library: TargetLibrary;
  /**
   * The Projection Paths of each Query Row. Omitted: the default projection.
   * Empty: identity-only rows.
   */
  readonly fields?: readonly string[] | undefined;
  /** The most rows to return. Omitted or `null`: every match. */
  readonly limit?: number | null | undefined;
}

export interface SortSpec {
  readonly field: string;
  readonly direction: "asc" | "desc";
}

/** The Item Query after defaults: what the engine ran. */
export interface ItemQuery {
  readonly fields: readonly string[];
  readonly sort: readonly SortSpec[];
  readonly limit: number | null;
}

/** A value of one Projection Path in a Query Row. */
export type ProjectionValue =
  | null
  | string
  | number
  | boolean
  | Temporal.Instant
  | Temporal.PlainDate
  | Temporal.PlainYearMonth
  | readonly ProjectionValue[]
  | { readonly [key: string]: ProjectionValue };

export interface QueryRow {
  readonly indexedKey: string;
  /** One entry for each requested Projection Path. */
  readonly values: Readonly<Record<string, ProjectionValue>>;
}

export interface QueryResult {
  /** The normalized request. */
  readonly query: ItemQuery;
  readonly rows: readonly QueryRow[];
  readonly returnedCount: number;
  /** More Items match than the limit returned. */
  readonly truncated: boolean;
}

/** The validated form of a request that the engine executes. */
export interface ItemQueryPlan {
  readonly query: ItemQuery;
  readonly paths: readonly PlannedPath[];
}

const PATH_HINTS = {
  "invalid-path":
    'Write the path in the template accessor grammar, such as date.year or custom["review.status"].',
  "unknown-field": `Use a field of the Item Query Schema, such as ${DEFAULT_FIELDS.join(", ")}. Reach a custom field with custom["exact name"].`,
  "unknown-path":
    "Select the complete field, or a path below it that the Item Query Schema lists.",
} as const;

const DEFAULT_SORT: readonly SortSpec[] = [
  { field: "dateModified", direction: "desc" },
];

/** Validate a request against the registries and apply the defaults. */
export function planRequest(
  request: ItemQueryRequest,
): Effect.Effect<ItemQueryPlan, ItemQueryError> {
  return Effect.gen(function* () {
    const fields = request.fields ?? DEFAULT_FIELDS;
    const paths: PlannedPath[] = [];
    for (const [index, text] of fields.entries()) {
      const path = planPath(text);
      if ("code" in path) {
        return yield* new ItemQueryError({
          code: path.code,
          location: { argument: "fields", index },
          message: path.message,
          hint: PATH_HINTS[path.code],
        });
      }
      paths.push(path);
    }

    const limit = request.limit ?? null;
    if (limit !== null && !(Number.isSafeInteger(limit) && limit > 0)) {
      return yield* new ItemQueryError({
        code: "invalid-limit",
        location: { argument: "limit" },
        message: `The limit ${limit} is not a positive integer.`,
        hint: "Use a positive integer, or omit the limit to get every match.",
      });
    }

    return { query: { fields: [...fields], sort: DEFAULT_SORT, limit }, paths };
  });
}
