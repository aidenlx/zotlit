// The static types the planner gives the subexpressions of a Filter Expression
// in an editor: what the value before a `.` is, with the Formulas and the
// Query Context of the view, and the members a filter reads on a record.
import type { QueryDataset } from "./dataset";
import type { Span } from "./fault";
import type { StaticType } from "./filter-plan";
import { planFormulas } from "./formulas";
import { NOTE_FIELDS } from "./note-fields";
import { ANNOTATIONS } from "./query-annotations";
import { ATTACHMENTS } from "./query-attachments";
import { ITEMS } from "./query-items";
import type { QueryContext } from "./request";

export interface PlannedMember {
  readonly name: string;
  readonly valueType: StaticType;
}

export interface SubexpressionType {
  readonly valueType: StaticType;
  /** The members a filter reads on the record it gives; absent for any other value. */
  readonly members?: readonly PlannedMember[];
}

/**
 * The Query Context of a view that binds one. Planning reads only whether a
 * record is bound, never its Indexed Key, so an editor types `this` without
 * the record the view will bind.
 */
const BOUND: QueryContext = { item: "", attachment: "" };

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

let memberNames: readonly string[] | undefined;

/** Every name a record of some Query Dataset can hold; the planner narrows them to one record's. */
function recordMemberNames(): readonly string[] {
  memberNames ??= [
    ...new Set(
      [
        ...[ITEMS, ATTACHMENTS, ANNOTATIONS].flatMap((dataset) =>
          dataset.names.map((name) => name.split(".")[0]!),
        ),
        ...NOTE_FIELDS.keys(),
      ].filter((name) => IDENTIFIER.test(name)),
    ),
  ];
  return memberNames;
}

/**
 * The types `dataset`'s planner gives the subexpressions of a Filter
 * Expression in a view.
 * @param options.context Whether the view binds a Query Context.
 * @param options.formulas The Formulas `formula.<name>` reads, each name with
 *   its text; a Formula with a mistake leaves its reads untyped.
 * @returns The type of the subexpression of `text` at exactly `at`, or
 *   undefined where `text` does not plan.
 */
export function subexpressionTypes(
  dataset: QueryDataset<any>,
  {
    context = false,
    formulas,
  }: {
    context?: boolean;
    formulas?: Readonly<Record<string, string>>;
  } = {},
): (text: string, at: Span) => SubexpressionType | undefined {
  const bound = context ? BOUND : undefined;
  // Each Formula is planned on its first read and kept for later reads.
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
  return (text, at) => {
    const planned = dataset.planSubexpression(text, at, {
      context: bound,
      formula: resolve,
    });
    if (!planned) return undefined;
    const { valueType, member } = planned;
    if (!member) return { valueType };
    return {
      valueType,
      members: recordMemberNames().flatMap((name) => {
        const type = member(name);
        return type === undefined ? [] : [{ name, valueType: type }];
      }),
    };
  };
}
