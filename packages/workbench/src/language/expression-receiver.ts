// What the value before a `.` is, as the planner of a Query Dataset reads it
// where it stands: its static type and, for a record, the members a filter
// reads on it. Expression Completion offers the members, and the Signature
// Hint selects a method by the type. The planner is the one judge, so the
// list cannot offer a member that evaluation rejects.
import type { SyntaxNode } from "@lezer/common";

import { parser } from "@zotlit/filter-expression";
import { subexpressionTypes } from "@zotlit/item-query";
import type { QueryDataset } from "@zotlit/item-query";

import type {
  ExpressionReceiver,
  ExpressionVocabulary,
} from "./expression-options";
import { bindingMethod, inFirstArgument, TAKES_INITIAL } from "./list-scope";
import type { Span } from "./span";

/**
 * The text the planner reads the receiver at `at` in: the receiver alone,
 * or, inside the element expression of a list method, the outermost such
 * call up to the receiver, its open brackets closed, so the names the method
 * binds mean what they mean there.
 */
function scopedText(source: string, at: Span): { text: string; span: Span } {
  let node: SyntaxNode | null = parser.parse(source).resolveInner(at.from, 1);
  while (node && !(node.from <= at.from && node.to >= at.to))
    node = node.parent;
  let outermost: SyntaxNode | null = null;
  const closers: string[] = [];
  let pending: string[] = [];
  for (
    let ancestor = node?.parent ?? null;
    ancestor;
    ancestor = ancestor.parent
  ) {
    const open = ancestor.getChild(ancestor.name === "Call" ? "(" : "[");
    const opened =
      ancestor.name === "GroupedExpression"
        ? ancestor.firstChild
        : ancestor.name === "Call" ||
            ancestor.name === "ArrayAccess" ||
            ancestor.name === "Array"
          ? open
          : null;
    if (!opened || opened.to > at.from) continue;
    const method = bindingMethod(ancestor, source);
    const inFirst = method !== null && inFirstArgument(ancestor, at.from);
    const closer =
      ancestor.name === "Call" || ancestor.name === "GroupedExpression"
        ? method &&
          TAKES_INITIAL.has(method) &&
          ancestor.getChildren(",").length === 0
          ? ", null)"
          : ")"
        : "]";
    pending.push(closer);
    if (method && inFirst) {
      outermost = ancestor;
      closers.push(...pending);
      pending = [];
    }
  }
  if (!outermost)
    return {
      text: source.slice(at.from, at.to),
      span: { from: 0, to: at.to - at.from },
    };
  const from = outermost.from;
  return {
    text: source.slice(from, at.to) + closers.join(""),
    span: { from: at.from - from, to: at.to - from },
  };
}

/**
 * How the planner of `dataset` reads the value before a `.`, where it
 * stands, with the view's Formulas and Query Context.
 * @see subexpressionTypes in `@zotlit/item-query`
 */
export function datasetReceiver(
  dataset: QueryDataset<any>,
  options: Parameters<typeof subexpressionTypes>[1] = {},
): NonNullable<ExpressionVocabulary["receiver"]> {
  const typeAt = subexpressionTypes(dataset, options);
  const read = (text: string, span: Span): ExpressionReceiver | undefined => {
    const planned = typeAt(text, span);
    if (!planned) return undefined;
    const type =
      planned.valueType === "unknown" ? undefined : planned.valueType;
    if (!planned.members) return { type };
    return {
      type,
      members: planned.members.flatMap(({ name, valueType }) =>
        valueType === "null"
          ? []
          : [
              {
                path: name,
                ...(valueType === "unknown" ? {} : { type: valueType }),
              },
            ],
      ),
    };
  };
  // A list asks again on each keystroke of the member name.
  let last: { key: string; value: ExpressionReceiver | undefined } | undefined;
  return (source, at) => {
    const { text, span } = scopedText(source, at);
    const key = `${span.from}:${span.to}:${text}`;
    if (last?.key !== key) last = { key, value: read(text, span) };
    return last.value;
  };
}
