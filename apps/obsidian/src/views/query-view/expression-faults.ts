// Where the Query View's expression editors underline a Fault: the span a
// Syntax Fault names, made wide enough to draw where parsing stopped at the
// end of the text, and the span of a Fault the last run found.
import { parseExpression } from "@zotlit/filter-expression";
import type {
  ExpressionSyntaxError,
  ParseExpressionResult,
} from "@zotlit/filter-expression";
import type { Span } from "@zotlit/workbench/language";

/** Where a run found a Fault: the text it planned, and the span in that text. */
export interface PlacedFault {
  readonly text: string;
  readonly span: Span;
}

/**
 * A fault at the end of the text names no character, so it takes the
 * unclosed string or bracket it is in, else the last token of `tree` before
 * it, such as a dangling operator.
 * @param tree The parse tree of the text that has the fault.
 * @returns the span to underline for a Syntax Fault, or `null` where no
 * token comes before the fault.
 */
export function syntaxFaultSpan(
  tree: ParseExpressionResult["tree"],
  { from, to, opened }: ExpressionSyntaxError,
): Span | null {
  if (from < to) return { from, to };
  if (opened) return { from: opened.from, to: Math.max(from, opened.to) };
  let last: Span | null = null;
  // Nodes come in order of where they start, so none after this one starts
  // before the fault.
  const cursor = tree.cursor();
  do {
    if (cursor.from >= from) break;
    const token =
      !cursor.type.isError &&
      cursor.from < cursor.to &&
      cursor.to <= from &&
      cursor.node.firstChild === null;
    if (token) last = { from: cursor.from, to: cursor.to };
  } while (cursor.next());
  return last;
}

/**
 * @returns the span of a Fault a run found, while `text` is the text that
 * run planned; `null` once the text differs.
 */
export function ranFaultSpan(
  text: string,
  ran: PlacedFault | undefined,
): Span | null {
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
): readonly Span[] {
  const { tree, error } = parseExpression(text);
  const span = error ? syntaxFaultSpan(tree, error) : ranFaultSpan(text, ran);
  return span ? [span] : [];
}
