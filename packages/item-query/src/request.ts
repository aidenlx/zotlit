import { Effect } from "effect";

import { ItemQueryError } from "./error";
import { DEFAULT_FIELDS, FIELD_NAMES, isFieldName } from "./fields";
import type { FieldName } from "./fields";

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
  readonly fields: readonly FieldName[];
}

const DEFAULT_SORT: readonly SortSpec[] = [
  { field: "dateModified", direction: "desc" },
];

/** Validate a request against the registries and apply the defaults. */
export function planRequest(
  request: ItemQueryRequest,
): Effect.Effect<ItemQueryPlan, ItemQueryError> {
  return Effect.gen(function* () {
    const fields: FieldName[] = [];
    for (const [index, name] of (request.fields ?? DEFAULT_FIELDS).entries()) {
      if (!isFieldName(name)) {
        return yield* new ItemQueryError({
          code: "unknown-field",
          location: { argument: "fields", index },
          message: `"${name}" is not a field of Item Query.`,
          hint: `Use one of these fields: ${FIELD_NAMES.join(", ")}.`,
        });
      }
      fields.push(name);
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

    return { query: { fields, sort: DEFAULT_SORT, limit }, fields };
  });
}
