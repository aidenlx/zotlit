// Formulas: named Filter Expressions of a request. The planner plans the
// Formulas that the request reads; the projection pass evaluates each one for
// a record and converts its value into the Query Row shape.
import { regex } from "arkregex";

import type { ItemQueryErrorCode } from "./error";
import { dateText } from "./filter-dates";
import type { DateValue } from "./filter-dates";
import {
  EVALUATION_ERROR_CODES,
  isError,
  renderEvaluationFault,
} from "./filter-error";
import { evaluateFormula } from "./filter-evaluate";
import type { FilterPlan } from "./filter-plan";
import { isDate, isList } from "./filter-values";
import type { FilterValue } from "./filter-values";
import type { PlannedPath } from "./projection";
import { readPath } from "./projection";
import type { QueryClock } from "./query-clock";
import type { ProjectionValue } from "./request";

/** The first segment of the Projection Path of every Formula. */
export const FORMULA_SEGMENT = "formula";

/** The form of a Formula name: an identifier. */
export const FORMULA_NAME = regex("^[A-Za-z_][A-Za-z0-9_]*$");

/** The Formula vocabulary of the Item Query Schema catalog. */
export const FORMULA_SCHEMA = {
  /** The Projection Path of a Formula in `fields` and in a Query Row. */
  path: `${FORMULA_SEGMENT}.<name>`,
  /** The form of a Formula name, as a regular expression. */
  name: FORMULA_NAME.source,
  /** The value types a Formula gives; each also holds null. */
  results: ["boolean", "number", "string", "list", "date"],
  /** The codes of a request that a Formula makes invalid. */
  codes: [
    "invalid-formula-name",
    "invalid-formula-result",
    "unknown-formula",
    "formula-cycle",
  ] satisfies ItemQueryErrorCode[],
  /** The codes of a Query Warning about a Formula. */
  warnings: ["unused-formula"],
  /**
   * A value that one record cannot compute: the Error Value, in a Query Row
   * as `{ kind: "error", code, message }`, also as a list element.
   */
  error: {
    type: "error",
    row: { kind: "error", code: "<code>", message: "<message>" },
    codes: EVALUATION_ERROR_CODES,
  },
};

/** A Formula that the request reads, planned against its Query Dataset. */
export interface PlannedFormula<Item = any, Needs = any> {
  readonly name: string;
  /** The Filter Expression text of the Formula. */
  readonly text: string;
  readonly plan: FilterPlan<Item, Needs>;
}

/** One value of a Query Row: a Projection Path or a Formula. */
export type PlannedColumn<Item = any, Needs = any> =
  | { readonly kind: "path"; readonly path: PlannedPath<Item, Needs> }
  | { readonly kind: "formula"; readonly formula: PlannedFormula<Item, Needs> };

/** The values of one Query Row, one for each column, in request order. */
export function projectColumns<Item>(
  columns: readonly PlannedColumn<Item>[],
  item: Item,
  clock: QueryClock,
): Record<string, ProjectionValue> {
  const values: Record<string, ProjectionValue> = {};
  for (const column of columns) {
    if (column.kind === "path")
      values[column.path.text] = readPath(column.path, item);
    else
      values[`${FORMULA_SEGMENT}.${column.formula.name}`] = formulaValue(
        evaluateFormula(column.formula.plan.root, item, clock),
      );
  }
  return values;
}

/**
 * A Formula value in the Query Row shape: a scalar as it is, a list element
 * by element, a calendar date in the date object shape of `date`, a
 * timestamp as an instant, and an Error Value as its code and rendered
 * message. A record, a duration, or a regexp is null.
 */
export function formulaValue(value: FilterValue): ProjectionValue {
  if (value === null || typeof value !== "object") return value;
  if (isList(value)) return value.map(formulaValue);
  if (isDate(value)) return dateObject(value);
  if (isError(value)) {
    return {
      kind: "error",
      code: value.fault.code,
      message: renderEvaluationFault(value.fault),
    };
  }
  return null;
}

function dateObject(date: DateValue): ProjectionValue {
  if (date.precision === "instant") return date.instant;
  const { first } = date;
  const raw = dateText(date);
  switch (date.precision) {
    case "year":
      return {
        kind: "year",
        value: null,
        year: first.year,
        month: null,
        day: null,
        text: null,
        raw,
      };
    case "month":
      return {
        kind: "yearMonth",
        value: first.toPlainYearMonth(),
        year: first.year,
        month: first.month,
        day: null,
        text: null,
        raw,
      };
    case "day":
      return {
        kind: "date",
        value: first,
        year: first.year,
        month: first.month,
        day: first.day,
        text: null,
        raw,
      };
  }
}
