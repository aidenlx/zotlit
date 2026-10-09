import { parseExpressionAst } from "@zotlit/filter-expression";
import type { ExpressionNode } from "@zotlit/filter-expression";

import type { ItemQueryErrorLocation } from "./error";
import type { Fault, PlainFault, Span, SyntaxFault } from "./fault";
import {
  GLOBAL_FUNCTIONS,
  METHOD_ENTRIES,
  takesType,
} from "./filter-functions";
import type { FunctionDefinition } from "./filter-functions";
import { planFilter } from "./filter-plan";
import type { QueryClock } from "./query-clock";

export interface DiagnosticLocation {
  readonly argument?: string;
  readonly index?: number;
  readonly span?: Span;
  readonly path?: string;
}
export interface Diagnostic<Code extends string = string> {
  readonly code: Code;
  readonly message: string;
  readonly hint: string;
  readonly severity: "error" | "warning";
  readonly report: readonly string[];
  readonly location?: DiagnosticLocation;
  readonly excerpt?: {
    readonly before: string;
    readonly at: string;
    readonly after: string;
  };
  readonly found: string;
  readonly expected: readonly string[];
  readonly suggestions: readonly string[];
}

/** Render the plain faults produced by the engine during the v2 migration. */
export function diagnose(
  fault: PlainFault | Extract<Fault, { kind: "syntax" }>,
  text: string,
  location: ItemQueryErrorLocation,
): Diagnostic<PlainFault["code"]> {
  if (fault.kind === "syntax")
    return diagnoseSyntax(fault.fault, text, location);
  return renderDiagnostic(
    {
      code: fault.code,
      message: fault.message,
      hint: fault.action,
      location: { ...location, ...(fault.at ? { span: fault.at } : {}) },
    },
    text,
  );
}

/** Shared rendering for engine faults and adapter rejections or operational failures. */
export function renderDiagnostic<Code extends string>(
  base: {
    readonly code: Code;
    readonly message: string;
    readonly hint: string;
    readonly location?: DiagnosticLocation;
  },
  text = "",
  data: { readonly found?: string; readonly expected?: readonly string[] } = {},
): Diagnostic<Code> {
  const span = base.location?.span;
  const excerpt = span
    ? {
        before: text.slice(Math.max(0, span.from - 40), span.from),
        at: text.slice(span.from, span.to),
        after: text.slice(span.to, span.to + 40),
      }
    : undefined;
  const report = [base.message];
  if (excerpt) {
    const escapedLength = (value: string) => JSON.stringify(value).length - 2;
    report.push(
      excerpt.before + excerpt.at + excerpt.after,
      " ".repeat(escapedLength(excerpt.before)) +
        "^".repeat(Math.max(1, escapedLength(excerpt.at))),
    );
  }
  report.push(base.hint);
  return {
    ...base,
    severity: "error",
    report,
    ...(excerpt ? { excerpt } : {}),
    found: data.found ?? "",
    expected: data.expected ?? [],
    suggestions: [],
  };
}

const SPOKEN_OPERATORS: Readonly<Record<string, string>> = {
  "&&": "AND",
  "||": "OR",
  "!": "NOT",
};

function diagnoseSyntax(
  fault: SyntaxFault,
  text: string,
  location: ItemQueryErrorLocation,
): Diagnostic<"invalid-filter"> {
  const matches = fault.expected.filter(
    (form) =>
      fault.found !== null &&
      text.slice(fault.from, fault.to) === fault.found &&
      SPOKEN_OPERATORS[form] === fault.found.toUpperCase(),
  );
  const suggestions =
    matches.length === 1
      ? [text.slice(0, fault.from) + matches[0] + text.slice(fault.to)]
      : [];
  const expected = fault.expected.join(", ");
  const diagnostic = renderDiagnostic(
    {
      code: "invalid-filter",
      message: `Found ${fault.found === null ? "end of filter" : JSON.stringify(fault.found)} where the filter takes ${expected}.`,
      hint: suggestions.length ? `Try: ${suggestions[0]}` : `Use ${expected}.`,
      location: { ...location, span: { from: fault.from, to: fault.to } },
    },
    text,
    { found: fault.found ?? "end of filter", expected: fault.expected },
  );
  const report = [...diagnostic.report];
  if (fault.opened) {
    const start = Math.max(0, fault.from - 40);
    const opener = fault.opened;
    // A distant opener gets its own bounded excerpt. Nearby openers share the
    // fault excerpt, with a second marker under the opening delimiter.
    const markerStart =
      opener.from < start ? Math.max(0, opener.from - 40) : start;
    const notes: string[] = [];
    if (opener.from < start)
      notes.push(text.slice(markerStart, opener.to + 40));
    notes.push(
      `${" ".repeat(
        JSON.stringify(text.slice(markerStart, opener.from)).length - 2,
      )}^ Opened here; close with ${JSON.stringify(opener.closer)}.`,
    );
    report.splice(report.length - 1, 0, ...notes);
  }
  return { ...diagnostic, suggestions, report };
}

/** Warnings describe the marked comparison; they never replace its evaluation. */
export function diagnoseWarning(
  fault: Extract<Fault, { kind: "constant" }>,
  text: string,
  clock: QueryClock,
): Diagnostic<"never-true" | "always-true"> {
  const left = text.slice(fault.left.at.from, fault.left.at.to);
  const right = text.slice(fault.right.at.from, fault.right.at.to);
  const suggestion = constantCorrection(fault, text, clock);
  const whole = parseExpressionAst(text).ast;
  const ungroup = (node: ExpressionNode): ExpressionNode =>
    node.type === "group" ? ungroup(node.expression) : node;
  const root = whole && ungroup(whole);
  const selectsAll =
    fault.value && root?.from === fault.at.from && root.to === fault.at.to;
  const diagnostic = renderDiagnostic(
    {
      code: fault.value ? "always-true" : "never-true",
      message: `${left} is a ${fault.left.type} and ${right} is a ${fault.right.type}: ${fault.operator} between them is ${fault.value ? "always" : "never"} true.${selectsAll ? " The filter selects every Item." : ""}`,
      hint: suggestion
        ? `Try: ${suggestion}`
        : "Compare values of the same type.",
      location: { argument: "filter", span: fault.at },
    },
    text,
    {
      found: `${fault.left.type} ${fault.operator} ${fault.right.type}`,
      expected: ["operands of the same type"],
    },
  );
  const start = Math.max(0, fault.at.from - 40);
  const length = (from: number, to: number) =>
    JSON.stringify(text.slice(from, to)).length - 2;
  const report = [...diagnostic.report];
  report[2] =
    " ".repeat(length(start, fault.left.at.from)) +
    "-".repeat(length(fault.left.at.from, fault.left.at.to)) +
    " ".repeat(length(fault.left.at.to, fault.right.at.from)) +
    "^".repeat(length(fault.right.at.from, fault.right.at.to));
  return {
    ...diagnostic,
    severity: "warning",
    report,
    suggestions: suggestion ? [suggestion] : [],
  };
}

function constantCorrection(
  fault: Extract<Fault, { kind: "constant" }>,
  text: string,
  clock: QueryClock,
): string | undefined {
  const left = text.slice(fault.left.at.from, fault.left.at.to);
  const right = text.slice(fault.right.at.from, fault.right.at.to);
  const rightAst = parseExpressionAst(right).ast;
  const eligible = (definition: FunctionDefinition) => {
    const parameter = definition.parameters[0];
    return (
      definition.parameters.length === 1 &&
      !definition.scope &&
      !definition.rest &&
      parameter &&
      fault.right.type !== "unknown" &&
      takesType(parameter, fault.right.type) &&
      (!parameter.values ||
        (rightAst?.type === "string" &&
          parameter.values.includes(rightAst.value)))
    );
  };
  let replacement: string | undefined;
  if (fault.operator === "==" || fault.operator === "!=") {
    const members = METHOD_ENTRIES.filter(
      ([owner, , definition]) =>
        owner === fault.left.type &&
        definition.diagnosticCorrection === "membership" &&
        definition.returns === "boolean" &&
        eligible(definition),
    );
    if (members.length === 1) {
      const leftAst = parseExpressionAst(left).ast;
      const receiver =
        leftAst?.type === "binary" || leftAst?.type === "unary"
          ? `(${left})`
          : left;
      replacement = `${fault.operator === "!=" ? "!" : ""}${receiver}.${members[0]![1]}(${right})`;
    }
  }
  if (!replacement && rightAst?.type === "string") {
    const literal = parseExpressionAst(rightAst.value).ast;
    if (
      literal &&
      (literal.type === "number" ||
        literal.type === "boolean" ||
        literal.type === "string" ||
        (literal.type === "unary" &&
          literal.operator === "-" &&
          literal.operand.type === "number"))
    ) {
      const type = literal.type === "unary" ? "number" : literal.type;
      if (type === fault.left.type)
        replacement = `${left} ${fault.operator} ${rightAst.value.trim()}`;
    }
    if (!replacement) {
      const conversions = [...GLOBAL_FUNCTIONS].filter(
        ([, definition]) =>
          definition.diagnosticCorrection === "conversion" &&
          definition.returns === fault.left.type &&
          eligible(definition) &&
          definition.call(null, [rightAst.value], clock) !== null,
      );
      if (conversions.length === 1)
        replacement = `${left} ${fault.operator} ${conversions[0]![0]}(${right})`;
    }
  }
  if (!replacement) return undefined;
  const corrected =
    text.slice(0, fault.at.from) + replacement + text.slice(fault.at.to);
  return "kind" in planFilter(corrected) ? undefined : corrected;
}
