// What the value before a `.` is, as the planner of a Query Dataset reads it
// where it stands: its static type and, for a record, the members a filter
// reads on it. Expression Completion offers the members, and the Signature
// Hint selects a method by the type. The planner is the one judge, so the
// list cannot offer a member that evaluation rejects.
import type { SyntaxNode } from "@lezer/common";

import { parser } from "@zotlit/filter-expression";
import {
  ANNOTATIONS,
  ATTACHMENTS,
  ITEMS,
  planFormulas,
} from "@zotlit/item-query";
import type { QueryContext, QueryDataset } from "@zotlit/item-query";

import type {
  ExpressionField,
  ExpressionReceiver,
  ExpressionVocabulary,
} from "./filter-expression-completion";
import { bindingMethod, inFirstArgument, TAKES_INITIAL } from "./list-scope";
import type { Span } from "./span";

/**
 * The Query Context the planner types `this` by. The planner reads only
 * whether a record is bound, so no Indexed Key is needed.
 */
const BOUND: QueryContext = { item: "", attachment: "" };

const IDENTIFIER = /^[A-Za-z_$¡-￿][\w$¡-￿]*$/;

let memberNames: readonly string[] | undefined;

/**
 * Every name a record of some Query Dataset may hold, which the planner
 * then narrows to the members of the record at hand.
 */
function recordMemberNames(): readonly string[] {
  memberNames ??= [
    ...new Set(
      [ITEMS, ATTACHMENTS, ANNOTATIONS].flatMap((dataset) =>
        dataset.names
          .map((name) => name.split(".")[0]!)
          .filter((name) => IDENTIFIER.test(name)),
      ),
    ),
  ];
  return memberNames;
}

interface PlannedNode extends Span {
  readonly valueType: string;
  readonly recordDataset?: string;
}

/**
 * The node of a planned tree at exactly `span`, the outermost of several.
 * A Formula's read holds the other Formula's tree, whose offsets are its
 * own text's, so the walk does not enter it.
 */
function nodeAt(node: unknown, span: Span): PlannedNode | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  if (Array.isArray(node)) {
    for (const element of node) {
      const found = nodeAt(element, span);
      if (found) return found;
    }
    return undefined;
  }
  if (!("valueType" in node) || !("from" in node) || !("to" in node))
    return undefined;
  const planned = node as PlannedNode;
  if (planned.from > span.from || planned.to < span.to) return undefined;
  if (planned.from === span.from && planned.to === span.to) return planned;
  for (const [key, child] of Object.entries(node)) {
    if (key === "root" || key === "value") continue;
    const found = nodeAt(child, span);
    if (found) return found;
  }
  return undefined;
}

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
 * How the planner of `dataset` reads the value before a `.`: where it
 * stands, with `this` bound when the view has a `context`, and
 * `formula.<name>` read from `formulas`. A receiver that does not plan is
 * undefined; one whose type is known only at execution has no type.
 */
export function datasetReceiver(
  dataset: QueryDataset<any>,
  {
    context = false,
    formulas,
  }: {
    /** Whether the view binds a Query Context. */
    context?: boolean;
    /** The Formulas `formula.<name>` reads, each name with its text. */
    formulas?: Readonly<Record<string, string>>;
  } = {},
): NonNullable<ExpressionVocabulary["receiver"]> {
  const bound = context ? BOUND : undefined;
  const planner =
    formulas &&
    planFormulas(dataset, {
      formulas,
      filter: undefined,
      fields: [],
      context: bound,
      policy: "leave-out",
    });
  const resolve = planner && "resolve" in planner ? planner.resolve : undefined;
  const planned = (text: string, span: Span) => {
    const plan = dataset.planFilter(text, bound, resolve);
    return "root" in plan ? nodeAt(plan.root, span) : undefined;
  };
  const read = (text: string, span: Span): ExpressionReceiver | undefined => {
    const node = planned(text, span);
    if (!node) return undefined;
    const type =
      node.valueType === "unknown"
        ? undefined
        : (node.valueType as ExpressionReceiver["type"]);
    if (type !== "record" && node.recordDataset === undefined) return { type };
    const members = recordMemberNames().flatMap((name): ExpressionField[] => {
      const member = planned(
        `${text.slice(0, span.to)}.${name}${text.slice(span.to)}`,
        { from: span.from, to: span.to + 1 + name.length },
      );
      if (!member || member.valueType === "null") return [];
      return [
        {
          path: name,
          ...(member.valueType === "unknown" ? {} : { type: member.valueType }),
        },
      ];
    });
    return { type, members };
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
