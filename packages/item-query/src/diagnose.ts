import type { ItemQueryErrorLocation } from "./error";
import type { Fault, PlainFault, Span, SyntaxFault } from "./fault";

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
      )  }^ Opened here; close with ${JSON.stringify(opener.closer)}.`,
    );
    report.splice(report.length - 1, 0, ...notes);
  }
  return { ...diagnostic, suggestions, report };
}
