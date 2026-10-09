import type { ItemQueryErrorCode, ItemQueryErrorLocation } from "./error";
import type { Callee, Fault, Span } from "./fault";
import { DEFAULT_FIELDS, filterField } from "./fields";
import {
  GLOBAL_FUNCTIONS,
  IF_FUNCTION,
  methodOf,
  methodsNamed,
} from "./filter-functions";
import type { FunctionDefinition } from "./filter-functions";

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

/** Render the faults produced by the engine during the v2 migration. */
export function diagnose(
  fault: Fault,
  text: string,
  location: ItemQueryErrorLocation,
): Diagnostic<ItemQueryErrorCode> {
  const at = "at" in fault ? fault.at : undefined;
  const faultLocation = { ...location, ...(at ? { span: at } : {}) };
  switch (fault.kind) {
    case "arity": {
      const definition = definitionOf(fault.callee);
      return renderDiagnostic(
        {
          code: "wrong-argument-count",
          message: `${fault.callee.name} takes ${describeCount(definition)}, not ${fault.given}.`,
          hint: `Call ${signature(callName(fault.callee), definition)}.`,
          location: faultLocation,
        },
        text,
      );
    }
    case "argument-type": {
      const definition = definitionOf(fault.callee);
      return renderDiagnostic(
        {
          code: "wrong-argument-type",
          message: `Argument ${fault.index + 1} of ${fault.callee.name} is ${fault.found}; ${fault.callee.name} takes ${fault.expected} there.`,
          hint: `Call ${signature(callName(fault.callee), definition)}.`,
          location: faultLocation,
        },
        text,
        { found: fault.found, expected: [fault.expected] },
      );
    }
    case "unreadable": {
      const custom = fault.name === "custom";
      const expected = custom
        ? ['custom["name"]']
        : DEFAULT_FIELDS.filter((name) => filterField(name)?.filterable);
      return renderDiagnostic(
        {
          code: "unfilterable-field",
          message: custom
            ? "custom is the set of all custom fields; a filter reads one of them."
            : `A filter cannot read ${JSON.stringify(fault.name)}.`,
          hint: custom
            ? 'Name one custom field, such as custom["review.status"].'
            : `Use a field that the Item Query Schema lists as filterable, such as ${expected.join(", ")}.`,
          location: faultLocation,
        },
        text,
        { found: fault.name, expected },
      );
    }
    case "plain":
      return renderDiagnostic(
        {
          code: fault.code,
          message: fault.message,
          hint: fault.action,
          location: faultLocation,
        },
        text,
      );
    default:
      throw new Error(`Cannot diagnose ${fault.kind} fault yet.`);
  }
}

function definitionOf(
  callee: Callee,
): Pick<FunctionDefinition, "parameters" | "optional" | "rest"> {
  if (!callee.receiver) {
    const definition =
      callee.name === "if" ? IF_FUNCTION : GLOBAL_FUNCTIONS.get(callee.name);
    if (definition) return definition;
  } else {
    const definition =
      callee.receiver.type === "unknown" || callee.receiver.type === "null"
        ? methodsNamed(callee.name)[0]?.[1]
        : methodOf(callee.receiver.type, callee.name);
    if (definition) return definition;
  }
  throw new Error(`No registered definition for ${callee.name}.`);
}

function callName(callee: Callee): string {
  return callee.receiver ? `value.${callee.name}` : callee.name;
}

function describeCount(
  definition: Pick<FunctionDefinition, "parameters" | "optional" | "rest">,
): string {
  const least = definition.parameters.length;
  const most = least + (definition.optional?.length ?? 0);
  const plural = (count: number) =>
    `${count} argument${count === 1 ? "" : "s"}`;
  if (definition.rest) return `at least ${plural(least)}`;
  return least === most ? plural(least) : `${least} to ${plural(most)}`;
}

function signature(
  name: string,
  definition: Pick<FunctionDefinition, "parameters" | "optional" | "rest">,
): string {
  const parts = [
    ...definition.parameters.map((parameter) => parameter.name),
    ...(definition.optional ?? []).map((parameter) => `${parameter.name}?`),
    ...(definition.rest ? [`...${definition.rest.name}`] : []),
  ];
  return `${name}(${parts.join(", ")})`;
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
