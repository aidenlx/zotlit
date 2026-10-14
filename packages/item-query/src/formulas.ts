// Formulas: named Filter Expressions of a request. The Formula planner plans
// the Formulas that the request reads and gives each one as a value, planned
// or faulted; the projection pass evaluates each one for a record and
// converts its value into the Query Row shape.
import { regex } from "arkregex";

import { parseExpressionAst } from "@zotlit/filter-expression";
import type { ExpressionNode } from "@zotlit/filter-expression";

import type { QueryDataset } from "./dataset";
import type { ItemQueryErrorCode, ItemQueryErrorLocation } from "./error";
import type { ItemQueryFault, Span } from "./fault";
import { dateText } from "./filter-dates";
import type { DateValue } from "./filter-dates";
import {
  EVALUATION_ERROR_CODES,
  isError,
  renderEvaluationFault,
} from "./filter-error";
import { evaluateFormula } from "./filter-evaluate";
import type {
  FaultedFormulaRead,
  FilterPlan,
  FormulaResolver,
} from "./filter-plan";
import { isDate, isList } from "./filter-values";
import type { FilterValue } from "./filter-values";
import { nameDictionary } from "./name-dictionary";
import type { PathProblem, PlannedPath } from "./projection";
import { readPath } from "./projection";
import { parseProjectionPath } from "./projection-path";
import type { QueryClock } from "./query-clock";
import type { ProjectionValue, QueryContext } from "./request";

/** The first segment of the Projection Path of every Formula. */
export const FORMULA_SEGMENT = "formula";

/** The form of a Formula name: an identifier. */
export const FORMULA_NAME = regex("^[A-Za-z_][A-Za-z0-9_]*$");

/** One `formula.<name>` that a Filter Expression reads, with its span. */
export interface FormulaReference {
  readonly name: string;
  readonly from: number;
  readonly to: number;
}

/**
 * The Formulas that the Filter Expression `text` reads, in the order of the
 * text: each `formula.<name>` as the planner resolves it, so a quoted
 * "formula.x" reads none and `formula . x` reads x. A text that does not
 * parse reads none; planning it gives its Syntax Fault.
 */
export function formulaReferences(text: string): FormulaReference[] {
  const { ast } = parseExpressionAst(text);
  const found: FormulaReference[] = [];
  const visit = (node: ExpressionNode) => {
    if (
      node.type === "object-access" &&
      node.object.type === "identifier" &&
      node.object.name === FORMULA_SEGMENT
    ) {
      found.push({ name: node.property, from: node.from, to: node.to });
      return;
    }
    for (const child of expressionChildren(node)) visit(child);
  };
  if (ast) visit(ast);
  return found.sort((a, b) => a.from - b.from);
}

/** The nodes directly under `node`. */
function expressionChildren(node: ExpressionNode): readonly ExpressionNode[] {
  switch (node.type) {
    case "binary":
      return [node.left, node.right];
    case "unary":
      return [node.operand];
    case "call":
      return [node.callee, ...node.args];
    case "array-access":
      return [node.object, node.index];
    case "object-access":
      return [node.object];
    case "array":
      return node.elements;
    case "group":
      return [node.expression];
    default:
      return [];
  }
}

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

/** A Formula that the request defines and that has a mistake. */
export interface FaultedFormula {
  readonly name: string;
  /** The Filter Expression text of the Formula. */
  readonly text: string;
  readonly fault: FormulaFault;
}

/**
 * The mistake of a {@link FaultedFormula}: a Fault in its own definition, or
 * the first Formula with a mistake that its text reads.
 */
export type FormulaFault =
  | { readonly kind: "own"; readonly error: FormulaError }
  | FaultedFormulaRead;

/**
 * The parts of the `ItemQueryError` of a Fault in a Formula definition, all
 * but the Query Dataset.
 */
export interface FormulaError {
  readonly fault: ItemQueryFault;
  readonly location: ItemQueryErrorLocation & { readonly argument: "formulas" };
  readonly argumentText: string;
  readonly context?: QueryContext | undefined;
}

/**
 * A Formula that `fields` reads as `formula.<name>`, or the Fault of the
 * Projection Path: another form of a path in the `formula` segment, or a name
 * that no Formula has.
 */
export type FormulaColumn<Item = any, Needs = any> =
  | PlannedFormula<Item, Needs>
  | FaultedFormula
  | { readonly problem: PathProblem | ItemQueryFault };

/**
 * The Formulas of one request, planned against its Query Dataset. A Formula
 * is planned once, when a Filter Expression or `fields` first reads it, and
 * gives the same answer to each later read.
 */
export interface FormulaPlanner<Item = any, Needs = any> {
  /**
   * The Formulas whose name is not an identifier, in request order. Each one
   * is faulted before any Formula is planned.
   */
  readonly invalidNames: readonly FaultedFormula[];
  /** The meaning of `formula.<name>` in a Filter Expression of the request. */
  readonly resolve: FormulaResolver<Item, Needs>;
  /**
   * The Formula that the Projection Path `text` of `fields` reads, or null for
   * a path outside the reserved `formula` segment.
   */
  readonly column: (text: string) => FormulaColumn<Item, Needs> | null;
  /**
   * The Fault at the root of a faulted Formula, or of a read of one: the
   * Fault in the definition of the first Formula, along the reads, that has
   * one of its own.
   */
  readonly rootError: (
    faulted: FaultedFormula | FaultedFormulaRead,
  ) => FormulaError;
  /**
   * The Fault of a faulted Formula itself: the Fault in its own definition,
   * or the read of the first Formula with a mistake that its text reads.
   */
  readonly error: (faulted: FaultedFormula) => FormulaError;
  /** The planned Formulas, each once, a Formula after the Formulas it reads. */
  readonly planned: () => readonly PlannedFormula<Item, Needs>[];
  /** The faulted Formulas, each once, with the invalid names first. */
  readonly faulted: () => readonly FaultedFormula[];
  /** The Formulas that the request defines and no read has planned. */
  readonly unread: () => readonly string[];
}

/** Plan the Formulas `definitions` of a request against `dataset`. */
export function planFormulas(
  dataset: QueryDataset<any>,
  definitions: Readonly<Record<string, string>> | undefined,
  context: QueryContext | undefined,
): FormulaPlanner {
  // The names come from the caller's text: a name such as __proto__ is a
  // Formula like any other.
  const defined = nameDictionary(Object.entries(definitions ?? {}));
  const names = Object.keys(defined);
  const invalidNames: FaultedFormula[] = names
    .filter((name) => !FORMULA_NAME.test(name))
    .map((name) => ({
      name,
      text: defined[name]!,
      fault: {
        kind: "own",
        error: {
          location: { argument: "formulas", path: name },
          fault: { kind: "formula-name", name },
          argumentText: name,
        },
      },
    }));
  const planned = new Map<string, PlannedFormula>();
  const faulted = new Map<string, FaultedFormula>(
    invalidNames.map((formula) => [formula.name, formula]),
  );
  // A Formula in `planning` is a reader of the one in planning after it, so a
  // name already there closes a cycle.
  const planning: string[] = [];

  const rootError = (
    formula: FaultedFormula | FaultedFormulaRead,
  ): FormulaError => {
    let fault = "fault" in formula ? formula.fault : formula;
    while (fault.kind === "reads-faulted-formula")
      fault = faulted.get(fault.name)!.fault;
    return fault.error;
  };

  const unknown = (name: string, at: Span) =>
    ({ kind: "unknown", role: "formula", name, at, formulas: names }) as const;

  const plan = (name: string): PlannedFormula | FaultedFormula => {
    const known = planned.get(name) ?? faulted.get(name);
    if (known) return known;
    const text = defined[name]!;
    planning.push(name);
    let result: ReturnType<typeof dataset.planFilter>;
    try {
      result = dataset.planFilter(text, context, resolve);
    } finally {
      planning.pop();
    }
    const own = (fault: ItemQueryFault, span: Span): FaultedFormula => ({
      name,
      text,
      fault: {
        kind: "own",
        error: {
          context,
          fault,
          location: { argument: "formulas", path: name, span },
          argumentText: text,
        },
      },
    });
    let formula: PlannedFormula | FaultedFormula;
    if ("kind" in result && result.kind === "reads-faulted-formula") {
      formula = { name, text, fault: result };
    } else if ("kind" in result) {
      formula = own(
        result,
        result.kind === "syntax"
          ? { from: result.fault.from, to: result.fault.to }
          : result.at,
      );
    } else {
      const found = result.root.valueType;
      if (found === "duration" || found === "regexp" || found === "record") {
        const at = { from: result.root.from, to: result.root.to };
        formula = own({ kind: "formula-result", name, found, at }, at);
      } else {
        formula = { name, text, plan: result };
      }
    }
    if ("fault" in formula) faulted.set(name, formula);
    else planned.set(name, formula);
    return formula;
  };

  const resolve: FormulaResolver<any, any> = (name, at) => {
    if (!Object.hasOwn(defined, name)) return unknown(name, at);
    const open = planning.indexOf(name);
    if (open !== -1) {
      return {
        kind: "formula-cycle",
        chain: [...planning.slice(open), name],
        at,
      };
    }
    const formula = plan(name);
    if ("fault" in formula) return { kind: "reads-faulted-formula", name, at };
    return { root: formula.plan.root, needs: formula.plan.needs };
  };

  return {
    invalidNames,
    resolve,
    column: (text) => {
      const name = formulaPath(text);
      if (name === null) return null;
      if (typeof name === "object") return { problem: name };
      if (!Object.hasOwn(defined, name))
        return { problem: unknown(name, { from: 0, to: text.length }) };
      return plan(name);
    },
    rootError,
    error: ({ name, text, fault }) => {
      if (fault.kind === "own") return fault.error;
      return {
        context,
        fault: { ...fault, root: rootError(fault) },
        location: { argument: "formulas", path: name, span: fault.at },
        argumentText: text,
      };
    },
    planned: () => [...planned.values()],
    faulted: () => [...faulted.values()],
    unread: () =>
      names.filter((name) => !planned.has(name) && !faulted.has(name)),
  };
}

/**
 * The Formula name of a `formula.<name>` Projection Path, or null for a path
 * outside the reserved `formula` segment. A Query Row holds a Formula under
 * `formula.<name>` alone, so another form of a path in that segment, such as
 * `formula["name"]`, is a Fault.
 */
function formulaPath(text: string): string | null | PathProblem {
  const parsed = parseProjectionPath(text);
  if (!parsed.ok || parsed.segments[0] !== FORMULA_SEGMENT) return null;
  const [, name, ...rest] = parsed.segments;
  if (
    typeof name === "string" &&
    rest.length === 0 &&
    text === `${FORMULA_SEGMENT}.${name}`
  )
    return name;
  return {
    kind: "plain",
    code: "invalid-path",
    action:
      typeof name === "string" && FORMULA_NAME.test(name)
        ? `Read the Formula as ${FORMULA_SEGMENT}.${name}.`
        : `Read a Formula as ${FORMULA_SEGMENT}.<name>.`,
    at: { from: 0, to: text.length },
    message: `"${text}" is not a Formula path: fields reads a Formula as ${FORMULA_SEGMENT}.<name>, and a Query Row holds its value under that key.`,
  };
}

/**
 * The Fault of a sort or a group by the Projection Path `text`, when it is in
 * the reserved `formula` segment: a Formula runs in the projection pass,
 * after the engine orders and groups the records. Null for every other path.
 */
export function formulaOrderFault(
  code: "unsortable-field" | "invalid-group",
  text: string,
): PathProblem | null {
  const parsed = parseProjectionPath(text);
  if (!parsed.ok || parsed.segments[0] !== FORMULA_SEGMENT) return null;
  const verb = code === "invalid-group" ? "group" : "sort";
  return {
    kind: "plain",
    code,
    at: { from: 0, to: text.length },
    message: `A query cannot ${verb} by ${text} yet: it ${verb}s by a field, not by a Formula.`,
    action: `${verb === "group" ? "Group" : "Sort"} by a field of the Query Dataset.`,
  };
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
