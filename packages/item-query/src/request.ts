// The request and the result of one Item Query, with the validation that
// applies the defaults and resolves each name against the registries.
import { Effect } from "effect";

import { parseIndexedKey } from "@zotlit/db";

import type { QueryDataset } from "./dataset";
import type { Diagnostic } from "./diagnose";
import { ItemQueryError } from "./error";
import type { ItemQueryErrorCode } from "./error";
import type { ItemQueryFault } from "./fault";
import type { FieldNeeds, QueryItem, SortKey } from "./fields";
import type { FaultedFormulaRead, FilterPlan } from "./filter-plan";
import { formulaOrderFault, planFormulas } from "./formulas";
import type { FaultedFormula, PlannedColumn, PlannedFormula } from "./formulas";
import { nameDictionary } from "./name-dictionary";
import type { NameDictionary } from "./name-dictionary";
import { canGroup, planPath, readPath } from "./projection";
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
   * the default sort of the Query Dataset. Indexed Key always breaks the last
   * tie.
   */
  readonly sort?: readonly SortSpec[] | undefined;
  /**
   * One scalar Projection Path, or a Projection Path with one `[]` whose
   * element is scalar: a record joins one group for each distinct element
   * value. The limit applies inside each group.
   */
  readonly group?: string | undefined;
  /** The most rows to return. Omitted or `null`: every match. */
  readonly limit?: number | null | undefined;
  /**
   * The Query Context: the records a Filter Expression reads as `this.item`
   * and `this.attachment`, each named by its Indexed Key. Omitted: `this`
   * has no value, and a filter that reads it is invalid.
   */
  readonly context?: QueryContext | undefined;
  /**
   * The Formulas of the request: each name with its Filter Expression text.
   * A name is an identifier. The query plans and evaluates a Formula only when
   * `fields` reads it as `formula.<name>`.
   */
  readonly formulas?: Readonly<Record<string, string>> | undefined;
  /**
   * What a Formula with a mistake does to the query. `"fail"`, the default:
   * the query fails with the first such mistake. `"leave-out"`: the Query
   * Rows leave out each such Formula and each Formula that reads one, and
   * `formulaFaults` of the answer gives their Diagnostics.
   */
  readonly formulaFaults?: "fail" | "leave-out" | undefined;
}

/**
 * The Formulas of a request that have a mistake, each by name with its
 * Diagnostic.
 */
export type FormulaFaults = NameDictionary<Diagnostic<ItemQueryErrorCode>>;

/** The records `this` binds, each by its Indexed Key. */
export interface QueryContext {
  readonly item?: string | undefined;
  readonly attachment?: string | undefined;
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
  /** The Query Context of the request, when it binds a record. */
  readonly context?: QueryContext;
  /** The Formulas of the request, when it names any. */
  readonly formulas?: Readonly<Record<string, string>>;
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
    | "unused-formula"
  >[];
  /**
   * The Formulas that the query left out, each with its Diagnostic: only
   * when the request leaves out Formulas with a mistake.
   */
  readonly formulaFaults?: FormulaFaults;
  /** The normalized request. */
  readonly query: ItemQuery;
  readonly returnedCount: number;
  /** More Items match than the limit returned. */
  readonly truncated: boolean;
}

/** The validated form of a request that the engine executes. */
export interface ItemQueryPlan<Item = any, Needs = any> {
  readonly dataset: QueryDataset<any>;
  readonly query: ItemQuery;
  /** `null`: every record matches. */
  readonly filter: FilterPlan<Item, Needs> | null;
  readonly paths: readonly PlannedPath<Item, Needs>[];
  /**
   * The Formulas that `fields`, the filter, or another Formula reads, each
   * once.
   */
  readonly formulas: readonly PlannedFormula<Item, Needs>[];
  /** The Formulas that the request names and never reads. */
  readonly unusedFormulas: readonly string[];
  /**
   * The Formulas with a mistake that the query leaves out, or null when the
   * request fails on such a Formula.
   */
  readonly formulaFaults: FormulaFaults | null;
  /** The values of each Query Row, in the order of `fields`. */
  readonly columns: readonly PlannedColumn<Item, Needs>[];
  readonly group: PlannedGroup<Item, Needs> | null;
  /** What hydration loads before reading each matched record's group values. */
  readonly groupNeeds: readonly Needs[];
  /** The request's sort and dataset tie-breakers. */
  readonly order: readonly SortSpec[];
  /** One entry for each entry of {@link ItemQueryPlan.order}. */
  readonly sorts: readonly PlannedSort<Item, Needs>[];
}

/** A validated group path and the groups that one record joins. */
export interface PlannedGroup<
  Item = QueryItem,
  Needs = FieldNeeds,
> extends PlannedPath<Item, Needs> {
  /**
   * Each distinct group value of the record, at least one. A scalar path
   * gives its value; an element path gives each distinct non-null element
   * value, or null when the list has none.
   */
  readonly values: (item: Item) => readonly GroupValue[];
}

function groupValues<Item, Needs>(
  path: PlannedPath<Item, Needs>,
): PlannedGroup<Item, Needs>["values"] {
  const wire = (value: ProjectionValue) =>
    JSON.parse(JSON.stringify(value)) as GroupValue;
  if (path.each === 0) return (item) => [wire(readPath(path, item))];
  return (item) => {
    const elements = readPath(path, item);
    const values = new Set<GroupValue>();
    if (Array.isArray(elements))
      for (const element of elements) {
        const value = wire(element);
        if (value !== null) values.add(value);
      }
    return values.size === 0 ? [null] : [...values];
  };
}

/** A validated Sortable Field and its direction. */
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
  /**
   * The custom fields of the source, which a request that leaves out
   * Formulas with a mistake reads before it plans them.
   */
  customFieldNames?: readonly string[],
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

    let context: QueryContext | undefined;
    for (const member of ["item", "attachment"] as const) {
      const key = request.context?.[member];
      if (key === undefined) continue;
      const parsed = parseIndexedKey(key);
      if (!parsed || (parsed.groupID !== null && parsed.groupID <= 0)) {
        return yield* new ItemQueryError({
          dataset,
          location: { argument: "context", path: `context.${member}` },
          fault: {
            kind: "plain",
            code: "invalid-context",
            message: `this.${member} names ${JSON.stringify(key)}, which is not an Indexed Key.`,
            action:
              'Bind an Indexed Key: a Zotero Key such as "ABCD2345", with g<groupID> after it for a group Library.',
          },
        });
      }
      context = { ...context, [member]: key };
    }

    // The policy for a Formula with a mistake. "fail": the request fails
    // with the Fault at its root, the first in request order. "leave-out":
    // the Query Rows leave out the Formula, and each Formula with a mistake
    // gets its Diagnostic.
    const leaveOut = request.formulaFaults === "leave-out";
    const formulas = planFormulas(dataset, request.formulas, {
      context,
      customFieldNames: leaveOut ? customFieldNames : undefined,
    });
    const formulaFailure = (
      faulted: FaultedFormula | FaultedFormulaRead,
    ): ItemQueryError =>
      new ItemQueryError({ dataset, ...formulas.rootError(faulted) });
    // A `formula.<name>` of fields that names no Formula, by name.
    const undefinedColumns: [string, ItemQueryError][] = [];
    const formulaFaults = (): FormulaFaults =>
      nameDictionary(
        [
          ...formulas
            .faulted()
            .map(
              (formula) =>
                [
                  formula.name,
                  new ItemQueryError({ dataset, ...formulas.error(formula) }),
                ] as const,
            ),
          ...undefinedColumns,
        ].map(([name, error]) => [name, error.diagnostic] as const),
      );
    const [invalidName] = formulas.invalidNames;
    if (invalidName && !leaveOut) return yield* formulaFailure(invalidName);

    let filter: FilterPlan | null = null;
    if (request.filter !== undefined) {
      const planned = dataset.planFilter(
        request.filter,
        context,
        formulas.resolve,
      );
      if ("kind" in planned) {
        if (planned.kind === "reads-faulted-formula") {
          if (!leaveOut) return yield* formulaFailure(planned);
          // Plan the Formulas of fields too, so the failure gives each
          // Formula with a mistake.
          for (const text of request.fields ?? dataset.defaultFields)
            formulas.column(text);
          formulas.planReads([request.filter]);
          return yield* new ItemQueryError({
            dataset,
            context,
            fault: { ...planned, root: formulas.rootError(planned) },
            location: { argument: "filter", span: planned.at },
            argumentText: request.filter,
            formulaFaults: formulaFaults(),
          });
        }
        return yield* new ItemQueryError({
          dataset,
          context,
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
    const columns: PlannedColumn[] = [];
    for (const [index, text] of fields.entries()) {
      const formula = formulas.column(text);
      if (formula !== null) {
        if ("problem" in formula) {
          const error = new ItemQueryError({
            dataset,
            fault: formula.problem,
            location: { argument: "fields", index, path: `fields[${index}]` },
            argumentText: JSON.stringify(fields),
          });
          const { problem } = formula;
          if (
            leaveOut &&
            problem.kind === "unknown" &&
            problem.role === "formula"
          ) {
            undefinedColumns.push([problem.name, error]);
            continue;
          }
          return yield* error;
        }
        if ("fault" in formula) {
          if (leaveOut) continue;
          return yield* formulaFailure(formula);
        }
        columns.push({ kind: "formula", formula });
        continue;
      }
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
      columns.push({ kind: "path", path });
    }

    let group: PlannedGroup | null = null;
    if (request.group !== undefined) {
      const text = request.group;
      const fail = (fault: ItemQueryFault) =>
        new ItemQueryError({
          dataset,
          fault,
          location: { argument: "group" },
          argumentText: text,
        });
      const byFormula = formulaOrderFault("invalid-group", text);
      if (byFormula) return yield* fail(byFormula);
      const path = planPath(text, dataset.resolvePath);
      if ("kind" in path) return yield* fail(path);
      if (!canGroup(path.shape, path.each))
        return yield* fail({
          kind: "group",
          problem:
            path.each > 1
              ? "each"
              : path.each === 0 && path.shape.kind === "list"
                ? "list"
                : "scalar",
          name: text,
          at: { from: 0, to: text.length },
        });
      group = { ...path, values: groupValues(path) };
    }

    const sort = request.sort ?? dataset.defaultSort;
    const sorts: PlannedSort<any, any>[] = [];
    for (const [index, { field, direction }] of sort.entries()) {
      const byFormula = formulaOrderFault("unsortable-field", field);
      if (byFormula) {
        return yield* new ItemQueryError({
          dataset,
          location: { argument: "sort", index, path: `sort[${index}].field` },
          argumentText: JSON.stringify(sort),
          fault: byFormula,
        });
      }
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

    // Each Formula that the request reads gets its own mark.
    if (leaveOut) formulas.planReads([]);

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
        ...(context === undefined ? {} : { context }),
        ...(request.formulas === undefined
          ? {}
          : { formulas: { ...request.formulas } }),
      },
      filter,
      paths,
      formulas: formulas.planned(),
      unusedFormulas: formulas.unread(),
      formulaFaults: leaveOut ? formulaFaults() : null,
      columns,
      group,
      groupNeeds: group ? [group.needs] : [],
      order: [...normalized, ...tieBreakers],
      sorts,
    };
  });
}
