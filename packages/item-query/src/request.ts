// The request and the result of one Item Query, with the validation that
// applies the defaults and resolves each name against the registries.
import { Effect } from "effect";

import type { QueryDataset } from "./dataset";
import type { Diagnostic } from "./diagnose";
import { ItemQueryError } from "./error";
import type { FieldNeeds, QueryItem, SortKey } from "./fields";
import type { FilterPlan } from "./filter-plan";
import { planPath, readPath } from "./projection";
import type { PlannedPath } from "./projection";
import { parseProjectionPath } from "./projection-path";
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
   * the default sort of the Query Dataset. Indexed Key always breaks the last
   * tie.
   */
  readonly sort?: readonly SortSpec[] | undefined;
  /** One scalar Projection Path; the limit applies inside each group. */
  readonly group?: string | undefined;
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
  readonly group?: string;
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

export type GroupValue = string | number | boolean | null;

export interface QueryGroup {
  readonly value: GroupValue;
  readonly count: number;
  readonly rows: readonly QueryRow[];
}

export type QueryResult = QueryMetadata &
  (
    | {
        readonly rows: readonly QueryRow[];
        readonly groups?: never;
        readonly totalCount?: never;
      }
    | {
        readonly groups: readonly QueryGroup[];
        readonly totalCount: number;
        readonly rows?: never;
      }
  );

export interface QueryMetadata {
  readonly warnings: readonly Diagnostic<
    | "never-true"
    | "always-true"
    | "key-outside-target-libraries"
    | "unknown-collection"
  >[];
  /** The normalized request. */
  readonly query: ItemQuery;
  readonly returnedCount: number;
  /** More Items match than the limit returned. */
  readonly truncated: boolean;
}

/** The validated form of a request that the engine executes. */
export interface ItemQueryPlan<Item = any, Needs = any> {
  readonly dataset: QueryDataset<any>;
  readonly warnings: FilterPlan["warnings"];
  readonly query: ItemQuery;
  /** `null`: every record matches. */
  readonly filter: FilterPlan<Item, Needs> | null;
  readonly paths: readonly PlannedPath<Item, Needs>[];
  readonly group: PlannedPath<Item, Needs> | null;
  /** The group value when given, then the request's sort and dataset tie-breakers. */
  readonly order: readonly SortSpec[];
  /** One entry for each entry of {@link ItemQueryPlan.order}. */
  readonly sorts: readonly PlannedSort<Item, Needs>[];
}

/** A validated ordering key: the group value or a Sortable Field. */
export interface PlannedSort<Item = QueryItem, Needs = FieldNeeds> {
  readonly direction: SortSpec["direction"];
  /** What hydration loads before {@link PlannedSort.key} runs. */
  readonly needs: Needs;
  readonly key: (item: Item, clock: QueryClock) => SortKey;
}

/** CLI forms for the query that counts every match with identity-only rows. */
export const COUNT_FIELDS: readonly string[] = [];
export const UNLIMITED_LIMIT = "all";

/**
 * Validate a request against the registries of its Query Dataset and apply
 * the defaults of the dataset.
 */
export function planRequest(
  dataset: QueryDataset<any>,
  request: ItemQueryRequest,
): Effect.Effect<ItemQueryPlan, ItemQueryError> {
  return Effect.gen(function* () {
    const libraryIDs = request.libraries.map((library) => library.libraryID);
    const repeated = libraryIDs.findIndex(
      (libraryID, index) => libraryIDs.indexOf(libraryID) !== index,
    );
    if (repeated !== -1) {
      return yield* new ItemQueryError({
        dataset,
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
      const planned = dataset.planFilter(request.filter);
      if ("kind" in planned) {
        return yield* new ItemQueryError({
          dataset,
          fault: planned,
          location: {
            argument: "filter",
            span:
              planned.kind === "syntax"
                ? { from: planned.fault.from, to: planned.fault.to }
                : planned.at,
          },
          argumentText: request.filter,
        });
      }
      filter = planned;
    }

    const fields = request.fields ?? dataset.defaultFields;
    const paths: PlannedPath[] = [];
    for (const [index, text] of fields.entries()) {
      const path = planPath(text, dataset.resolvePath);
      if ("kind" in path) {
        return yield* new ItemQueryError({
          dataset,
          fault: path,
          location: { argument: "fields", index, path: `fields[${index}]` },
          argumentText: JSON.stringify(fields),
        });
      }
      paths.push(path);
    }

    let group: PlannedPath | null = null;
    if (request.group !== undefined) {
      const parsed = parseProjectionPath(request.group);
      const path = planPath(request.group, dataset.resolvePath);
      const nonScalar =
        (parsed.ok &&
          parsed.segments.some((segment) => typeof segment === "object")) ||
        (!("kind" in path) && !path.scalar);
      const fault = nonScalar
        ? {
            kind: "group-scalar" as const,
            name: request.group,
            at: { from: 0, to: request.group.length },
          }
        : "kind" in path
          ? path
          : null;
      if (fault)
        return yield* new ItemQueryError({
          dataset,
          fault,
          location: { argument: "group" },
          argumentText: request.group,
        });
      if (!("kind" in path)) group = path;
    }

    const sort = request.sort ?? dataset.defaultSort;
    const sorts: PlannedSort<any, any>[] = [];
    for (const [index, { field, direction }] of sort.entries()) {
      const sortable = dataset.sortable(field);
      if (!sortable) {
        return yield* new ItemQueryError({
          dataset,
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
      sorts.push({ direction, ...sortable });
    }
    // A tie-breaker that the sort already names adds no order.
    const tieBreakers = dataset.tieBreakers.filter(
      (tie) => !sort.some(({ field }) => field === tie.field),
    );
    for (const { field, direction } of tieBreakers) {
      sorts.push({ direction, ...dataset.sortable(field)! });
    }

    const limit = request.limit ?? null;
    if (limit !== null && !(Number.isSafeInteger(limit) && limit > 0)) {
      return yield* new ItemQueryError({
        dataset,
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

    // Group value leads the internal order. Dataset hydration already loads
    // every ordering key, so grouping needs no dataset-specific execution.
    if (group) {
      const path = group;
      sorts.unshift({
        direction: "asc",
        needs: path.needs,
        key: (item) =>
          JSON.parse(JSON.stringify(readPath(path, item))) as GroupValue,
      });
    }
    const normalized = sort.map(({ field, direction }) => ({
      field,
      direction,
    }));
    return {
      dataset,
      query: {
        filter: request.filter ?? null,
        fields: [...fields],
        sort: normalized,
        limit,
        ...(request.group === undefined ? {} : { group: request.group }),
      },
      filter,
      warnings: filter?.warnings ?? [],
      paths,
      group,
      order: [
        ...(group ? [{ field: group.text, direction: "asc" as const }] : []),
        ...normalized,
        ...tieBreakers,
      ],
      sorts,
    };
  });
}
