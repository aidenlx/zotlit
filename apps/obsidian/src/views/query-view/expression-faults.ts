// Where the Query View's expression editors underline a Fault: the span a
// Syntax Fault names, made wide enough to draw where parsing stopped at the
// end of the text.
import type { ExpressionSyntaxError } from "@zotlit/filter-expression";

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
