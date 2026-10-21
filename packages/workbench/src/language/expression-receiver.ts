// What the value before a `.` is, as the planner of a Query Dataset reads it
// where it stands in the text being typed: its static type and, for a record,
// the members a filter reads on it, a name a list method binds typed by that
// method's scope. Expression Completion offers the members, and the Signature
// Hint selects a method by the type. The planner is the one judge, so the
// list cannot offer a member that evaluation rejects.
import { subexpressionTypes } from "@zotlit/item-query";
import type { QueryDataset } from "@zotlit/item-query";

import type {
  ExpressionReceiver,
  ExpressionVocabulary,
} from "./expression-options";
import type { Span } from "./span";

/**
 * How the planner of `dataset` reads the value before a `.`, where it
 * stands, with the view's Formulas and Query Context.
 * @see subexpressionTypes in `@zotlit/item-query`
 */
export function datasetReceiver(
  dataset: QueryDataset<any>,
  {
    label,
    ...options
  }: NonNullable<Parameters<typeof subexpressionTypes>[1]> & {
    /** The label the Properties popover gives a field, by its full path. */
    label?: (path: string) => string | undefined;
  } = {},
): NonNullable<ExpressionVocabulary["receiver"]> {
  const typeAt = subexpressionTypes(dataset, options);
  const read = (text: string, span: Span): ExpressionReceiver | undefined => {
    const planned = typeAt(text, span);
    if (!planned) return undefined;
    const type =
      planned.valueType === "unknown" ? undefined : planned.valueType;
    if (!planned.members) return { type };
    const receiver = text.slice(span.from, span.to).replaceAll(/\s+/g, "");
    return {
      type,
      members: planned.members.flatMap(({ name, valueType }) => {
        if (valueType === "null") return [];
        const path = `${receiver}.${name}`;
        const named = label?.(path);
        return [
          {
            path: name,
            ...(valueType === "unknown" ? {} : { type: valueType }),
            // A label that only repeats the path is none.
            ...(named === undefined || named === path ? {} : { label: named }),
          },
        ];
      }),
    };
  };
  // A list asks again on each keystroke of the member name.
  let last: { key: string; value: ExpressionReceiver | undefined } | undefined;
  return (source, at) => {
    const key = `${at.from}:${at.to}:${source}`;
    if (last?.key !== key) last = { key, value: read(source, at) };
    return last.value;
  };
}
