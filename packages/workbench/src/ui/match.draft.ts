import type {
  AvailableLibrary,
  FlatCondition,
  MatchCondition,
} from "#/match/condition";
import type { ReactNode } from "react";

import type { MatchTree } from "@zotlit/templates/facade";

// Preserve nested Match trees and expression rows through labelled edits.
import type { WorkbenchMessages } from "./generated/messages";
import { describeProblem } from "./match.diagnostic";

import { compileCondition, formatCondition } from "#/match/condition";

/** What a fresh condition tests: the type the ticketed example starts from. */
export const DEFAULT_ITEM_TYPE = "book";

/** A leaf the visual rows cannot show: its Filter Expression, as written. */
export interface ExpressionCondition {
  kind: "expression";
  text: string;
}

/**
 * A row a condition kind shows with its own controls. `kind` names its entry
 * in the vocabulary; `"group"` and `"expression"` belong to the editor.
 */
export interface LabelledRow {
  kind: string;
}

/** A condition the editor shows as one row. */
export type RowCondition<Row extends LabelledRow = FlatCondition> =
  | Row
  | ExpressionCondition;
/** What a labelled row can test; an expression row is reached by toggling a row. */
export type ConditionKind = FlatCondition["kind"];
export type GroupMatch = "all" | "any";
export interface ConditionGroup<Row extends LabelledRow = FlatCondition> {
  kind: "group";
  match: GroupMatch;
  conditions: EditorCondition<Row>[];
}
export type EditorCondition<Row extends LabelledRow = FlatCondition> =
  | ConditionGroup<Row>
  | RowCondition<Row>;

/** A child's position in the tree: the index at each nesting level. */
export type ConditionPath = readonly number[];

/**
 * A stored filter in the Bases `filters` shape. The editor writes `and` and
 * `or` groups; it reads a `not` group as one expression row.
 */
export type MatchFilter =
  | string
  | { readonly and: readonly MatchFilter[] }
  | { readonly or: readonly MatchFilter[] }
  | { readonly not: readonly MatchFilter[] };

/** The controls of one labelled row, wired to its value. */
export interface ConditionControlProps<Row extends LabelledRow> {
  condition: Row;
  onChange: (next: Row) => void;
}

/** One thing a condition can test: its label, its controls, and its expression text. */
export interface MatchConditionKind<Row extends LabelledRow> {
  kind: Row["kind"];
  /** The name the kind picker shows, in the reader's language. */
  label: string;
  /** The icon the kind picker shows before the chosen kind's name, if any. */
  icon?: ReactNode;
  /** A row of this kind at its starting value. */
  fresh: () => Row;
  /** The row one Filter Expression leaf reads as, or `null` when it is not this kind. */
  parse: (text: string) => Row | null;
  /** The Filter Expression a row of this kind stores. */
  format: (row: Row) => string;
  /** The operator control, shown after the kind picker. */
  renderOperator?: (props: ConditionControlProps<Row>) => ReactNode;
  /** The value control. */
  renderValue: (props: ConditionControlProps<Row>) => ReactNode;
}

/** The conditions a Match editor offers, which its caller supplies. */
export interface MatchVocabulary<Row extends LabelledRow> {
  kinds: readonly MatchConditionKind<Row>[];
  /** The kind of the row an empty Match shows. */
  starterKind: Row["kind"];
  /** The kind "Add condition" adds and a new group starts with. */
  newKind: Row["kind"];
  /** What keeps one row from being saved, as the reader reads it. */
  issue?: (condition: RowCondition<Row>, path: ConditionPath) => string | null;
}

export function isGroup<Row extends LabelledRow>(
  node: EditorCondition<Row>,
): node is ConditionGroup<Row> {
  return node.kind === "group";
}

export function isExpression<Row extends LabelledRow>(
  node: RowCondition<Row>,
): node is ExpressionCondition {
  return node.kind === "expression";
}

function kindOf<Row extends LabelledRow>(
  vocabulary: MatchVocabulary<Row>,
  kind: Row["kind"],
): MatchConditionKind<Row> {
  const entry = vocabulary.kinds.find((entry) => entry.kind === kind);
  if (!entry) throw new Error(`Unknown Match condition kind: ${kind}`);
  return entry;
}

/** A row of `kind` at its starting value. */
export function freshRow<Row extends LabelledRow>(
  vocabulary: MatchVocabulary<Row>,
  kind: Row["kind"],
): Row {
  return kindOf(vocabulary, kind).fresh();
}

/** Vocabulary supplied by the current host. */
export interface MatchEditorDeps {
  libraries: readonly (AvailableLibrary & { name?: string })[];
  tags: readonly string[];
  /** Root-first Collection paths available in this host. */
  collections: readonly { path: readonly string[] }[];
}

/**
 * The tree of a stored filter. A leaf that one condition kind reads becomes
 * that row; any other leaf — a blank, a problem, or an expression that
 * combines tests — stays as written in an expression row, and so does a
 * `not` group. A lone leaf sits in a "Match all" group.
 */
export function fromFilter<Row extends LabelledRow>(
  filter: MatchFilter,
  vocabulary: MatchVocabulary<Row>,
): ConditionGroup<Row> {
  const node = editorNode(filter, vocabulary);
  return isGroup(node)
    ? node
    : { kind: "group", match: "all", conditions: [node] };
}

function editorNode<Row extends LabelledRow>(
  filter: MatchFilter,
  vocabulary: MatchVocabulary<Row>,
): EditorCondition<Row> {
  if (typeof filter === "string")
    return (
      asLabelled({ kind: "expression", text: filter }, vocabulary) ?? {
        kind: "expression",
        text: filter,
      }
    );
  if ("not" in filter) return { kind: "expression", text: filterText(filter) };
  const all = "and" in filter;
  return {
    kind: "group",
    match: all ? "all" : "any",
    conditions: (all ? filter.and : filter.or).map((entry) =>
      editorNode(entry, vocabulary),
    ),
  };
}

/** One Filter Expression with the meaning of a stored filter. */
function filterText(filter: MatchFilter): string {
  if (typeof filter === "string") return filter;
  const [entries, operator, empty] =
    "and" in filter
      ? [filter.and, " && ", "true"]
      : "or" in filter
        ? [filter.or, " || ", "!true"]
        : [filter.not, " || ", "!true"];
  const joined =
    entries.length === 0
      ? empty
      : entries.length === 1
        ? filterText(entries[0]!)
        : entries.map((entry) => `(${filterText(entry)})`).join(operator);
  // A `not` group holds when none of its entries does.
  return "not" in filter ? `!(${joined})` : joined;
}

/** The filter a tree stores: rows as their kind writes them, expression rows as typed. */
export function toFilter<Row extends LabelledRow>(
  group: ConditionGroup<Row>,
  vocabulary: MatchVocabulary<Row>,
): MatchTree {
  const entries = group.conditions.map((condition) =>
    isGroup(condition)
      ? toFilter(condition, vocabulary)
      : isExpression(condition)
        ? condition.text
        : kindOf(vocabulary, condition.kind).format(condition),
  );
  return group.match === "all" ? { and: entries } : { or: entries };
}

/** Whether `group` stores `filter`, so that reading `filter` again changes nothing. */
export function storesFilter<Row extends LabelledRow>(
  group: ConditionGroup<Row>,
  filter: MatchFilter | undefined,
  vocabulary: MatchVocabulary<Row>,
): boolean {
  return filter === undefined
    ? group.conditions.length === 0
    : JSON.stringify(toFilter(group, vocabulary)) === JSON.stringify(filter);
}

/** The tree a compiled condition reads as: a lone condition sits in a "Match all" group. */
export function asGroup(condition: MatchCondition): ConditionGroup {
  return condition.kind === "group"
    ? condition
    : { kind: "group", match: "all", conditions: [condition] };
}

/** `root` with the group at `path` replaced by `fn`'s result. */
export function updateGroup<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  path: ConditionPath,
  fn: (group: ConditionGroup<Row>) => ConditionGroup<Row>,
): ConditionGroup<Row> {
  if (path.length === 0) return fn(root);
  const [index, ...rest] = path;
  return {
    ...root,
    conditions: root.conditions.map((child, at) =>
      at === index && isGroup(child) ? updateGroup(child, rest, fn) : child,
    ),
  };
}

/** `root` with the condition at `path` replaced by `next`. */
export function replaceAt<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  path: ConditionPath,
  next: EditorCondition<Row>,
): ConditionGroup<Row> {
  const index = path.at(-1)!;
  return updateGroup(root, path.slice(0, -1), (group) => ({
    ...group,
    conditions: group.conditions.map((child, at) =>
      at === index ? next : child,
    ),
  }));
}

/** `root` without the condition at `path`. */
export function removeAt<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  path: ConditionPath,
): ConditionGroup<Row> {
  const index = path.at(-1)!;
  return updateGroup(root, path.slice(0, -1), (group) => ({
    ...group,
    conditions: group.conditions.filter((_, at) => at !== index),
  }));
}

/** `root` with `child` appended to the group at `path`. */
export function appendAt<Row extends LabelledRow>(
  root: ConditionGroup<Row>,
  path: ConditionPath,
  child: EditorCondition<Row>,
): ConditionGroup<Row> {
  return updateGroup(root, path, (group) => ({
    ...group,
    conditions: [...group.conditions, child],
  }));
}

/**
 * Whether the Profile rows show `condition`: a negated "contains any" or
 * "contains all" has no row operator.
 */
export function visuallyEditable(
  condition: MatchCondition,
): condition is FlatCondition {
  return (
    condition.kind !== "group" &&
    ((condition.kind !== "collections" && condition.kind !== "tags") ||
      !condition.negated ||
      condition.operator === "contains" ||
      condition.operator === "within" ||
      condition.operator === "isEmpty")
  );
}

/** A condition of `kind` at its starting value, keeping the operator. */
export function freshCondition(
  kind: ConditionKind,
  negated: boolean,
): FlatCondition {
  switch (kind) {
    case "library":
      return { kind, operator: "is", negated, values: ["personal"] };
    case "item-type":
      return { kind, operator: "is", negated, values: [DEFAULT_ITEM_TYPE] };
    case "collections":
      return { kind, operator: "within", negated, values: [] };
    case "tags":
      return { kind, operator: "contains", negated, values: [] };
  }
}

/** A labelled row as an expression row: its meaning, as text. */
export function asExpression<Row extends LabelledRow>(
  condition: Row,
  vocabulary: MatchVocabulary<Row>,
): ExpressionCondition {
  return {
    kind: "expression",
    text: kindOf(vocabulary, condition.kind).format(condition),
  };
}

/**
 * An expression row as a labelled row, when one condition kind reads its
 * text; `null` while it reads as anything else.
 */
export function asLabelled<Row extends LabelledRow>(
  condition: ExpressionCondition,
  vocabulary: MatchVocabulary<Row>,
): Row | null {
  for (const kind of vocabulary.kinds) {
    const row = kind.parse(condition.text);
    if (row) return row;
  }
  return null;
}

/**
 * A new group takes the other match and one condition, so it starts as the
 * alternative or exception the user reached for.
 */
export function freshGroup<Row extends LabelledRow>(
  parent: GroupMatch,
  vocabulary: MatchVocabulary<Row>,
): ConditionGroup<Row> {
  return {
    kind: "group",
    match: parent === "all" ? "any" : "all",
    conditions: [freshRow(vocabulary, vocabulary.newKind)],
  };
}

/**
 * What keeps one row from being saved, as the user reads it. An expression
 * row answers through the same tree checks as the visual rows.
 */
export function conditionIssue(
  m: WorkbenchMessages,
  condition: RowCondition,
  deps: MatchEditorDeps,
): string | null {
  switch (condition.kind) {
    case "library": {
      const { problem } = compileCondition(
        formatCondition(condition),
        deps.libraries,
      );
      return problem ? describeProblem(m, problem) : null;
    }
    case "item-type":
      return null;
    case "collections":
      return condition.operator !== "isEmpty" &&
        (condition.values.length === 0 ||
          condition.values.some(
            (path) =>
              path.length === 0 || path.some((segment) => segment === ""),
          ))
        ? m.workbench_match_collection_empty()
        : null;
    case "tags":
      return condition.operator !== "isEmpty" &&
        (condition.values.length === 0 ||
          condition.values.some((value) => value === ""))
        ? m.workbench_match_tag_empty()
        : null;
    case "expression": {
      const { condition: compiled, problem } = compileCondition(
        condition.text,
        deps.libraries,
      );
      if (problem) return describeProblem(m, problem);
      return treeIssue(m, asGroup(compiled), deps);
    }
  }
}

/** The first incomplete condition, as the user reads it. */
export function treeIssue(
  m: WorkbenchMessages,
  group: ConditionGroup,
  deps: MatchEditorDeps,
): string | null {
  for (const condition of group.conditions) {
    const issue =
      condition.kind === "group"
        ? treeIssue(m, condition, deps)
        : conditionIssue(m, condition, deps);
    if (issue) return issue;
  }
  return null;
}
