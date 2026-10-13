import { diagnoseDecode, renderDiagnostic } from "@zotlit/item-query";
import type { Diagnostic as RenderedDiagnostic } from "@zotlit/item-query";

import type { CliRejection } from "./cli-params";

export type { RenderedDiagnostic };

type DiagnosticCode<THints> = Extract<keyof THints, string>;

/**
 * Build the diagnostics of one CLI namespace from its registered recovery
 * actions. The namespace keeps its own code vocabulary and details union.
 */
export function createCliDiagnostics<
  const THints extends Readonly<Record<string, string>>,
  TDetails,
>(hints: THints, invalidParameterCode: DiagnosticCode<THints>) {
  type Code = DiagnosticCode<THints>;

  function buildDiagnostic<TDiagnosticDetails>(
    code: Code,
    message: string,
    details?: TDiagnosticDetails,
  ) {
    const hint: string = hints[code]!;
    return { code, message, hint, details };
  }

  function diagnostic(code: Code, message: string, details?: TDetails) {
    return buildDiagnostic(code, message, details);
  }

  function rejectionDiagnostic(rejection: CliRejection) {
    const rejected = buildDiagnostic(invalidParameterCode, rejection.message, {
      parameter: rejection.parameter,
    });
    return rejection.hint === undefined
      ? rejected
      : { ...rejected, hint: rejection.hint };
  }

  return { diagnostic, rejectionDiagnostic };
}

/** A fault inside caller-written text: the text, and where in it. */
export interface SourceFault {
  /** The whole text the offsets address, such as a Template's source. */
  readonly source: string;
  /** UTF-16 offsets into `source`; `to` is exclusive. */
  readonly span: { readonly from: number; readonly to: number };
  /** What the text is, as the location line names it, such as a Template name. */
  readonly name: string;
}

/** What a namespace knows about one fault beyond its code and message. */
export interface FaultFacts {
  /** The most specific recovery action; the code's registered one otherwise. */
  readonly hint?: string;
  readonly at?: SourceFault;
  /** The path of the responsible value, such as a manifest field. */
  readonly path?: string;
}

/** 1-based line and column of `offset` in `source`. */
export function lineColumn(
  source: string,
  offset: number,
): { readonly line: number; readonly column: number } {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line: before.split("\n").length, column: offset - lineStart + 1 };
}

/**
 * The diagnostics of one CLI namespace with the Diagnostic Report of the Item
 * Query CLI: every diagnostic carries `severity`, `report`, `found`,
 * `expected`, and `suggestions`, and a rejected parameter carries the valibot
 * path and received value. One renderer serves every namespace that uses it.
 */
export function createRenderedCliDiagnostics<
  const THints extends Readonly<Record<string, string>>,
  TDetails,
>(hints: THints, invalidParameterCode: DiagnosticCode<THints>) {
  type Code = DiagnosticCode<THints>;
  const base = createCliDiagnostics<THints, TDetails>(
    hints,
    invalidParameterCode,
  );

  function diagnostic(code: Code, message: string, details?: TDetails) {
    return faultDiagnostic(code, message, { details });
  }

  function faultDiagnostic(
    code: Code,
    message: string,
    facts: FaultFacts & { readonly details?: TDetails },
  ) {
    const value = base.diagnostic(code, message, facts.details);
    const registered = value.hint;
    const hint = facts.hint ?? registered;
    // The registered action stays the last line, after a more specific one.
    const withRegistered = (report: readonly string[]): readonly string[] =>
      hint === registered ? report : [...report, registered];
    const { at } = facts;
    if (!at) {
      const rendered = renderDiagnostic({
        code,
        message,
        hint,
        ...(facts.path ? { location: { path: facts.path } } : {}),
      });
      return { ...value, ...rendered, report: withRegistered(rendered.report) };
    }
    // The excerpt is the span's own line, so a multi-line source still reads
    // as one line with its caret under the fault.
    const { line, column } = lineColumn(at.source, at.span.from);
    const lineStart = at.span.from - column + 1;
    const lineEnd = at.source.indexOf("\n", lineStart);
    const text = at.source.slice(
      lineStart,
      lineEnd === -1 ? undefined : lineEnd,
    );
    const rendered = renderDiagnostic(
      {
        code,
        message,
        hint,
        location: {
          span: {
            from: at.span.from - lineStart,
            to: Math.min(at.span.to, lineStart + text.length) - lineStart,
          },
        },
      },
      text,
      { found: at.source.slice(at.span.from, at.span.to) },
    );
    const [head, ...rest] = rendered.report;
    return {
      ...value,
      ...rendered,
      location: { span: at.span, ...(facts.path ? { path: facts.path } : {}) },
      report: withRegistered([
        head!,
        `--> ${at.name}:${line}:${column}`,
        ...rest,
      ]),
    };
  }

  function rejectionDiagnostic(rejection: CliRejection) {
    const value = base.rejectionDiagnostic(rejection);
    return {
      ...value,
      ...diagnoseDecode(rejection, value.hint),
      code: value.code,
    };
  }

  return { diagnostic, faultDiagnostic, rejectionDiagnostic };
}
