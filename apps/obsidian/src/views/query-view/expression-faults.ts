// Where the Query View's expression editors underline a Fault: the span a
// Syntax Fault names, made wide enough to draw where parsing stopped at the
// end of the text, and the span of a Fault the last run found.
import { parseExpression } from "@zotlit/filter-expression";
import type { ExpressionSyntaxError } from "@zotlit/filter-expression";
import type { ExpressionFault } from "@zotlit/workbench/ui";

import type { ConditionIssue } from "./query-file";

/** A part of an expression's text, in UTF-16 offsets; `to` is exclusive. */
export interface FaultSpan {
  readonly from: number;
  readonly to: number;
}

/**
 * The span to underline for a Syntax Fault of `text`. A fault at the end of
 * the text names no character, so it takes the unclosed string or bracket
 * it is in, else the last token before it, such as a dangling operator.
 */
export function syntaxFaultSpan(
  text: string,
  { from, to, opened }: ExpressionSyntaxError,
): FaultSpan | null {
  if (from < to) return { from, to };
  if (opened) return { from: opened.from, to: Math.max(from, opened.to) };
  const end = text.slice(0, from).trimEnd().length;
  const start = text.slice(0, end).search(/\S*$/);
  return start < end ? { from: start, to: end } : null;
}

/**
 * The Faults an expression condition underlines in `text`, as typed: its
 * Syntax Fault at once, else the Fault the last run found in it while the
 * text is the one that run planned.
 */
export function conditionFaults(
  text: string,
  issue: ConditionIssue | null,
): readonly ExpressionFault[] {
  const ran = issue?.text === text ? issue : null;
  const { error } = parseExpression(text);
  const span = error
    ? syntaxFaultSpan(text, error)
    : ran?.span && ran.span.from < ran.span.to
      ? ran.span
      : null;
  if (!span) return [];
  return [ran ? { ...span, message: ran.message } : span];
}
