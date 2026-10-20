// Where the Query View's expression editors underline a Fault: the span a
// Syntax Fault names, made wide enough to draw where parsing stopped at the
// end of the text, and the span of a Fault the last run found.
import { parseExpression } from "@zotlit/filter-expression";
import type { ExpressionSyntaxError } from "@zotlit/filter-expression";
import type { FaultSpan } from "@zotlit/workbench/ui";

/** Where a run found a Fault: the text it planned, and the span in that text. */
export interface PlacedFault {
  readonly text: string;
  readonly span: FaultSpan;
}

/**
 * A fault at the end of the text names no character, so it takes the
 * unclosed string or bracket it is in, else the last token before it, such
 * as a dangling operator.
 * @returns the span to underline for a Syntax Fault of `text`, or `null`
 * where no character comes before the fault.
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
 * @returns the span of a Fault a run found, while `text` is the text that
 * run planned; `null` once the text differs.
 */
export function ranFaultSpan(
  text: string,
  ran: PlacedFault | undefined,
): FaultSpan | null {
  return ran?.text === text ? ran.span : null;
}

/**
 * @param text An expression condition as typed.
 * @param ran Where the last run found a Fault in this condition.
 * @returns the condition's Syntax Fault at once, else the run's Fault.
 */
export function conditionFaults(
  text: string,
  ran: PlacedFault | undefined,
): readonly FaultSpan[] {
  const { error } = parseExpression(text);
  const span = error ? syntaxFaultSpan(text, error) : ranFaultSpan(text, ran);
  return span ? [span] : [];
}
