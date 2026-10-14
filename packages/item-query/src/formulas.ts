// Formulas: named Filter Expressions of a request. The Formula planner plans
// the Formulas that the request reads, gives each one as a value, planned or
// faulted, and applies the policy of the request to a faulted one; the
// projection pass evaluates each one for a record and
// converts its value into the Query Row shape.
import { regex } from "arkregex";

import { parseExpressionAst } from "@zotlit/filter-expression";
import type { ExpressionNode } from "@zotlit/filter-expression";

import type { QueryDataset } from "./dataset";
import { ItemQueryError } from "./error";
import type { ItemQueryErrorCode, ItemQueryErrorLocation } from "./error";
import type { FaultedFormulaRead, ItemQueryFault, Span } from "./fault";
import { dateText } from "./filter-dates";
import type { DateValue } from "./filter-dates";
import {
  EVALUATION_ERROR_CODES,
  isError,
  renderEvaluationFault,
} from "./filter-error";
import { evaluateFormula } from "./filter-evaluate";
import type { FilterPlan, FormulaResolver } from "./filter-plan";
import { isDate, isList } from "./filter-values";
import type { FilterValue } from "./filter-values";
import { nameDictionary } from "./name-dictionary";
import type { PathProblem, PlannedPath } from "./projection";
import { readPath } from "./projection";
import { parseProjectionPath } from "./projection-path";
import type { QueryClock } from "./query-clock";
import type {
  FormulaDiagnostics,
  ProjectionValue,
  QueryContext,
} from "./request";

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

/**
 * What a Formula with a mistake does to the query. `"fail"`: the query fails
 * with the Fault at the root of the first such Formula, in request order.
 * `"leave-out"`: the Query Rows leave out each such Formula and each Formula
 * that reads one, and each gets its Diagnostic.
 */
export type FormulaFaultPolicy = "fail" | "leave-out";

/** A Formula that the request reads, planned against its Query Dataset. */
export interface PlannedFormula<Item = any, Needs = any> {
  readonly name: string;
  /** The Filter Expression text of the Formula. */
  readonly text: string;
  readonly plan: FilterPlan<Item, Needs>;
}

/** A Formula that the request defines and that has a mistake. */
interface FaultedFormula {
  readonly name: string;
  /** The Filter Expression text of the Formula. */
  readonly text: string;
  /**
   * A Fault in its own definition, or the read of the first Formula with a
   * mistake that its text reads.
   */
  readonly fault:
    | { readonly kind: "own"; readonly error: FormulaError }
    | FaultedFormulaRead;
}

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

/** A Fault that the source finds in the text of a planned Formula. */
export interface FormulaSourceFault {
  readonly fault: ItemQueryFault;
  readonly at: Span;
}

/** The parts of a request that the Formula planner reads. */
export interface FormulaRequest {
  /** The Formulas that the request defines, each name with its text. */
  readonly formulas: Readonly<Record<string, string>> | undefined;
  readonly filter: string | undefined;
  /** The Projection Paths of each Query Row, after the defaults. */
  readonly fields: readonly string[];
  readonly context: QueryContext | undefined;
  readonly policy: FormulaFaultPolicy;
  /**
   * The Faults that the source finds in planned Formulas, by name: a custom
   * field that the source lacks. Each one is a mistake in its Formula.
   */
  readonly sourceFaults?: ReadonlyMap<string, FormulaSourceFault> | undefined;
}

/**
 * The Formulas of one request, planned against its Query Dataset under the
 * policy of the request. A Formula is planned once, when a Filter Expression
 * or `fields` first reads it, and gives the same answer to each later read.
 */
export interface FormulaPlanner<Item = any, Needs = any> {
  /** The meaning of `formula.<name>` in the filter of the request. */
  readonly resolve: FormulaResolver<Item, Needs>;
  /**
   * The failure of a request whose filter reads, at `read`, a Formula with a
   * mistake. `"fail"`: the Fault at the root of that Formula. `"leave-out"`:
   * the read at the filter, with the Diagnostic of each Formula with a
   * mistake that the request reads.
   */
  readonly filterFailure: (read: FaultedFormulaRead) => ItemQueryError;
  /**
   * The value of the Projection Path `fields[index]` when it is in the
   * reserved `formula` segment: the planned Formula, `"left-out"` for a
   * Formula with a mistake that the policy leaves out, or the failure of the
   * request. Null for every other path.
   */
  readonly column: (
    index: number,
  ) =>
    | Extract<PlannedColumn<Item, Needs>, { kind: "formula" }>
    | "left-out"
    | ItemQueryError
    | null;
  /** The Formulas of the request, once the rest of it is planned. */
  readonly finish: () => PlannedFormulas<Item, Needs>;
}

/** The Formulas of a planned request. */
export interface PlannedFormulas<Item = any, Needs = any> {
  /** The planned Formulas, each once, a Formula after the Formulas it reads. */
  readonly planned: readonly PlannedFormula<Item, Needs>[];
  /**
   * The Formulas that the request defines and nothing reads. `"leave-out"`
   * gives none: its caller sends Formulas that its other requests read.
   */
  readonly unused: readonly string[];
  /**
   * `"leave-out"`: each Formula with a mistake that the request reads, with
   * its Diagnostic. `"fail"`: null.
   */
  readonly diagnostics: FormulaDiagnostics | null;
}

/**
 * Plan the Formulas of `request` against `dataset`. `"fail"` with a Formula
 * name that is not an identifier gives the failure of the request.
 */
export function planFormulas(
  dataset: QueryDataset<any>,
  request: FormulaRequest,
): FormulaPlanner | ItemQueryError {
  const { context, fields, sourceFaults } = request;
  const leaveOut = request.policy === "leave-out";
  // The names come from the caller's text: a name such as __proto__ is a
  // Formula like any other.
  const defined = nameDictionary(Object.entries(request.formulas ?? {}));
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
  const rootError = ({ fault }: FaultedFormula): FormulaError =>
    fault.kind === "own" ? fault.error : fault.root;
  /** The failure of a request that fails on the Formula `faulted`. */
  const failure = (faulted: FaultedFormula) =>
    new ItemQueryError({ dataset, ...rootError(faulted) });
  const [invalidName] = invalidNames;
  if (invalidName && !leaveOut) return failure(invalidName);

  const planned = new Map<string, PlannedFormula>();
  const faulted = new Map<string, FaultedFormula>(
    invalidNames.map((formula) => [formula.name, formula]),
  );
  // A `formula.<name>` of fields that names no Formula, by name.
  const undefinedColumns = new Map<string, ItemQueryError>();
  // A Formula in `planning` is a reader of the one in planning after it, so a
  // name already there closes a cycle.
  const planning: string[] = [];

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
      const fromSource = sourceFaults?.get(name);
      if (found === "duration" || found === "regexp" || found === "record") {
        const at = { from: result.root.from, to: result.root.to };
        formula = own({ kind: "formula-result", name, found, at }, at);
      } else if (fromSource) {
        formula = own(fromSource.fault, fromSource.at);
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
    if ("fault" in formula) {
      return {
        kind: "reads-faulted-formula",
        name,
        at,
        root: rootError(formula),
      };
    }
    return { root: formula.plan.root, needs: formula.plan.needs };
  };

  /**
   * The Fault of a faulted Formula itself: the Fault in its own definition,
   * or the read of the first Formula with a mistake that its text reads.
   */
  const ownError = ({ name, text, fault }: FaultedFormula): FormulaError => {
    // A Formula on a cycle gives the cycle from itself, at its read of the
    // next Formula of the cycle.
    const root = fault.kind === "own" ? fault.error : fault.root;
    if (root.fault.kind === "formula-cycle") {
      const chain = root.fault.chain.slice(0, -1);
      const at = chain.indexOf(name);
      if (at !== -1) {
        const from = [...chain.slice(at), ...chain.slice(0, at)];
        const span = fault.kind === "own" ? root.fault.at : fault.at;
        return {
          ...root,
          fault: { ...root.fault, chain: [...from, name], at: span },
          location: { ...root.location, path: name, span },
          argumentText: text,
        };
      }
    }
    if (fault.kind === "own") return fault.error;
    return {
      context,
      fault,
      location: { argument: "formulas", path: name, span: fault.at },
      argumentText: text,
    };
  };

  /**
   * Plan each Formula that `texts` or a planned Formula reads, also after a
   * reader's first read of a Formula with a mistake, so that each Formula the
   * request reads is planned or faulted.
   */
  const planReads = (texts: readonly string[]) => {
    const invalid = new Set(invalidNames.map((formula) => formula.name));
    const queued = new Set<string>();
    const queue = [...texts];
    const enqueuePlanned = () => {
      for (const formula of [...planned.values(), ...faulted.values()]) {
        if (invalid.has(formula.name) || queued.has(formula.name)) continue;
        queued.add(formula.name);
        queue.push(formula.text);
      }
    };
    enqueuePlanned();
    for (let text = queue.pop(); text !== undefined; text = queue.pop()) {
      for (const { name } of formulaReferences(text))
        if (
          Object.hasOwn(defined, name) &&
          !planned.has(name) &&
          !faulted.has(name)
        )
          plan(name);
      enqueuePlanned();
    }
  };

  /** The Diagnostic of each Formula with a mistake, by name. */
  const diagnostics = (): FormulaDiagnostics =>
    nameDictionary(
      [
        ...[...faulted.values()].map(
          (formula) =>
            [
              formula.name,
              new ItemQueryError({ dataset, ...ownError(formula) }),
            ] as const,
        ),
        ...undefinedColumns,
      ].map(([name, error]) => [name, error.diagnostic] as const),
    );

  const column: FormulaPlanner["column"] = (index) => {
    const text = fields[index]!;
    const name = formulaPath(text);
    if (name === null) return null;
    const fieldFailure = (fault: ItemQueryFault) =>
      new ItemQueryError({
        dataset,
        fault,
        location: { argument: "fields", index, path: `fields[${index}]` },
        argumentText: JSON.stringify(fields),
      });
    if (typeof name === "object") return fieldFailure(name);
    if (!Object.hasOwn(defined, name)) {
      const error = fieldFailure(unknown(name, { from: 0, to: text.length }));
      if (!leaveOut) return error;
      if (!undefinedColumns.has(name)) undefinedColumns.set(name, error);
      return "left-out";
    }
    const formula = plan(name);
    if ("fault" in formula) return leaveOut ? "left-out" : failure(formula);
    return { kind: "formula", formula };
  };

  return {
    resolve,
    column,
    filterFailure: (read) => {
      if (!leaveOut) return new ItemQueryError({ dataset, ...read.root });
      // Plan the Formulas of fields too, so the failure gives each Formula
      // with a mistake.
      for (const index of fields.keys()) column(index);
      const filter = request.filter ?? "";
      planReads([filter]);
      return new ItemQueryError({
        dataset,
        context,
        fault: read,
        location: { argument: "filter", span: read.at },
        argumentText: filter,
        formulaDiagnostics: diagnostics(),
      });
    },
    finish: () => {
      if (!leaveOut) {
        return {
          planned: [...planned.values()],
          unused: names.filter(
            (name) => !planned.has(name) && !faulted.has(name),
          ),
          diagnostics: null,
        };
      }
      // Each Formula that the request reads gets its own mark.
      planReads([]);
      return {
        planned: [...planned.values()],
        unused: [],
        diagnostics: diagnostics(),
      };
    },
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
