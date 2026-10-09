// The request and the result of one Item Query, with the validation that
// applies the defaults and resolves each name against the registries.
import { Effect } from "effect";

import type { Diagnostic } from "./diagnose";
import { ItemQueryError } from "./error";
import { DEFAULT_FIELDS, fieldDefinition } from "./fields";
import type { FieldNeeds, QueryItem, SortKey } from "./fields";
import { planFilter } from "./filter-plan";
import type { FilterPlan } from "./filter-plan";
import { planPath } from "./projection";
import type { PlannedPath } from "./projection";
import type { QueryClock } from "./query-clock";

/**
 * One Target Library, resolved by the caller. `libraryID` is local to the
 * database copy; `groupID` is `null` for the personal Library.
 */
export interface TargetLibrary {
  readonly libraryID: number;
  readonly groupID: number | null;
}

export interface ItemQueryRequest {
  /**
   * The Target Libraries: each Library once, in any order. Their Items make
   * one result set. An empty list gives an empty Query Result; a Library that
   * the list names twice is invalid.
   */
  readonly libraries: readonly TargetLibrary[];
  /**
   * The Filter Expression that selects the Items. Omitted: every Item matches.
   * An empty filter is invalid.
   */
  readonly filter?: string | undefined;
  /**
   * The Projection Paths of each Query Row. Omitted: the default projection.
   * Empty: identity-only rows.
   */
  readonly fields?: readonly string[] | undefined;
  /**
   * The Sortable Fields that order the result, the first one first. Omitted:
   * modification time, descending. Indexed Key always breaks the last tie.
   */
  readonly sort?: readonly SortSpec[] | undefined;
  /** The most rows to return. Omitted or `null`: every match. */
  readonly limit?: number | null | undefined;
}

export interface SortSpec {
  readonly field: string;
  readonly direction: "asc" | "desc";
}

/** The Item Query after defaults: what the engine ran. */
export interface ItemQuery {
  /** `null`: every Item matches. */
  readonly filter: string | null;
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
  readonly attachmentIndexedKey?: string;
  readonly itemIndexedKey?: string;
  /** One entry for each requested Projection Path. */
  readonly values: Readonly<Record<string, ProjectionValue>>;
}

export interface QueryResult {
  readonly warnings: readonly Diagnostic<"never-true" | "always-true">[];
  /** The normalized request. */
  readonly query: ItemQuery;
  readonly rows: readonly QueryRow[];
  readonly returnedCount: number;
  /** More Items match than the limit returned. */
  readonly truncated: boolean;
}

/** The validated form of a request that the engine executes. */
export interface ItemQueryPlan {
  readonly warnings: FilterPlan["warnings"];
  readonly query: ItemQuery;
  /** `null`: every Item matches. */
  readonly filter: FilterPlan | null;
  readonly paths: readonly PlannedPath[];
  readonly sorts: readonly PlannedSort[];
}

/** A validated entry of the sort list. */
export interface PlannedSort {
  readonly direction: SortSpec["direction"];
  /** What hydration loads before {@link PlannedSort.key} runs. */
  readonly needs: FieldNeeds;
  readonly key: (item: QueryItem, clock: QueryClock) => SortKey;
}

/** CLI forms for the query that counts every match with identity-only rows. */
export const COUNT_FIELDS: readonly string[] = [];
export const UNLIMITED_LIMIT = "all";

/** The sort of a request that names no sort. */
export const DEFAULT_SORT: readonly SortSpec[] = [
  { field: "dateModified", direction: "desc" },
];

/** Validate a request against the registries and apply the defaults. */
export function planRequest(
  request: ItemQueryRequest,
): Effect.Effect<ItemQueryPlan, ItemQueryError> {
  return Effect.gen(function* () {
    const libraryIDs = request.libraries.map((library) => library.libraryID);
    const repeated = libraryIDs.findIndex(
      (libraryID, index) => libraryIDs.indexOf(libraryID) !== index,
    );
    if (repeated !== -1) {
      return yield* new ItemQueryError({
        location: { argument: "libraries", index: repeated },
        fault: {
          kind: "plain",
          code: "duplicate-library",
          message: `The request names the Library with the local ID ${libraryIDs[repeated]} twice.`,
          action: "Name each Target Library once.",
        },
      });
    }

    let filter: FilterPlan | null = null;
    if (request.filter !== undefined) {
      const planned = planFilter(request.filter);
      if ("kind" in planned) {
        return yield* new ItemQueryError({
          fault: planned,
          location: {
            argument: "filter",
            span:
              planned.kind === "syntax"
                ? { from: planned.fault.from, to: planned.fault.to }
                : planned.at,
          },
        });
      }
      filter = planned;
    }

    const fields = request.fields ?? DEFAULT_FIELDS;
    const paths: PlannedPath[] = [];
    for (const [index, text] of fields.entries()) {
      const path = planPath(text);
      if ("kind" in path) {
        return yield* new ItemQueryError({
          fault: path,
          location: { argument: "fields", index, path: `fields[${index}]` },
          argumentText: JSON.stringify(fields),
        });
      }
      paths.push(path);
    }

    const sort = request.sort ?? DEFAULT_SORT;
    const sorts: PlannedSort[] = [];
    for (const [index, { field, direction }] of sort.entries()) {
      const definition = fieldDefinition(field);
      if (!definition?.sortKey) {
        return yield* new ItemQueryError({
          location: { argument: "sort", index, path: `sort[${index}].field` },
          argumentText: JSON.stringify(sort),
          fault: {
            kind: "unknown",
            role: "sortable-field",
            name: field,
            at: { from: 0, to: field.length },
          },
        });
      }
      sorts.push({
        direction,
        needs: definition.needs([]),
        key: definition.sortKey,
      });
    }

    const limit = request.limit ?? null;
    if (limit !== null && !(Number.isSafeInteger(limit) && limit > 0)) {
      return yield* new ItemQueryError({
        location: { argument: "limit" },
        fault: {
          kind: "plain",
          code: "invalid-limit",
          message: `The limit ${limit} is not a positive integer.`,
          action:
            "Use a positive integer, or omit the limit to get every match.",
        },
      });
    }

    return {
      query: {
        filter: request.filter ?? null,
        fields: [...fields],
        sort: sort.map(({ field, direction }) => ({ field, direction })),
        limit,
      },
      filter,
      warnings: filter?.warnings ?? [],
      paths,
      sorts,
    };
  });
}
