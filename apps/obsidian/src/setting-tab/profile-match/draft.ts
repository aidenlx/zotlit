import type { MatchTree } from "@zotlit/templates/facade";

// Match editor drafts preserve groups and leaves outside the labelled controls.
import * as m from "@/lib/i18n/generated/messages";
import type { AvailableLibrary } from "@/services/library-scope/scope";
import {
  compileCondition,
  describeProblem,
  formatCondition,
} from "@/services/profile-selection";
import type {
  CollectionChoice,
  FlatCondition,
  MatchCondition,
} from "@/services/profile-selection";

/** What a fresh condition tests: the type the ticketed example starts from. */
export const DEFAULT_ITEM_TYPE = "book";

/** A leaf the visual rows cannot show: its Filter Expression, as written. */
export interface ExpressionCondition {
  kind: "expression";
  text: string;
}

/** A condition the editor shows as one row. */
export type RowCondition = FlatCondition | ExpressionCondition;
/** What a labelled row can test; an expression row is reached by toggling a row. */
export type ConditionKind = FlatCondition["kind"];
export type GroupMatch = "all" | "any";
export interface ConditionGroup {
  kind: "group";
  match: GroupMatch;
  conditions: EditorCondition[];
}
export type EditorCondition = ConditionGroup | RowCondition;

/** A child's position in the tree: the index at each nesting level. */
export type ConditionPath = readonly number[];

export interface MatchDraft {
  root: ConditionGroup;
}

/** What the editor reads from the plugin while it is open. */
export interface MatchEditorDeps {
  libraries: readonly AvailableLibrary[];
  /** The Collections the database offers, read once when the dialog opens. */
  collections: readonly CollectionChoice[];
}

/** An absent match starts with one item-type condition. */
export function initialDraft(match?: MatchTree): MatchDraft {
  return {
    root:
      match === undefined
        ? {
            kind: "group",
            match: "all",
            conditions: [freshCondition("item-type", false)],
          }
        : fromFilter(match),
  };
}

/**
 * The tree of a stored filter. A leaf that reads as one item-type,
 * Collection, or Tag test becomes that row; any other leaf — a blank, a
 * problem, or an expression that combines tests — stays as written in an
 * expression row. A lone leaf sits in a "Match all" group.
 */
export function fromFilter(filter: MatchTree): ConditionGroup {
  const node = editorNode(filter);
  return node.kind === "group"
    ? node
    : { kind: "group", match: "all", conditions: [node] };
}

function editorNode(filter: MatchTree): EditorCondition {
  if (typeof filter !== "string") {
    const all = "and" in filter;
    return {
      kind: "group",
      match: all ? "all" : "any",
      conditions: (all ? filter.and : filter.or).map(editorNode),
    };
  }
  const { condition } = compileCondition(filter);
  return condition && visuallyEditable(condition)
    ? condition
    : { kind: "expression", text: filter };
}

function visuallyEditable(
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

/** The filter a tree stores: rows as canonical expressions, expression rows as typed. */
export function toFilter(group: ConditionGroup): MatchTree {
  const entries = group.conditions.map((condition) =>
    condition.kind === "group"
      ? toFilter(condition)
      : condition.kind === "expression"
        ? condition.text
        : formatCondition(condition),
  );
  return group.match === "all" ? { and: entries } : { or: entries };
}

/** The tree a compiled condition reads as: a lone condition sits in a "Match all" group. */
export function asGroup(condition: MatchCondition): ConditionGroup {
  return condition.kind === "group"
    ? condition
    : { kind: "group", match: "all", conditions: [condition] };
}

/** `root` with the group at `path` replaced by `fn`'s result. */
export function updateGroup(
  root: ConditionGroup,
  path: ConditionPath,
  fn: (group: ConditionGroup) => ConditionGroup,
): ConditionGroup {
  if (path.length === 0) return fn(root);
  const [index, ...rest] = path;
  return {
    ...root,
    conditions: root.conditions.map((child, at) =>
      at === index && child.kind === "group"
        ? updateGroup(child, rest, fn)
        : child,
    ),
  };
}

/** `root` with the condition at `path` replaced by `next`. */
export function replaceAt(
  root: ConditionGroup,
  path: ConditionPath,
  next: EditorCondition,
): ConditionGroup {
  const index = path.at(-1)!;
  return updateGroup(root, path.slice(0, -1), (group) => ({
    ...group,
    conditions: group.conditions.map((child, at) =>
      at === index ? next : child,
    ),
  }));
}

/** `root` without the condition at `path`. */
export function removeAt(
  root: ConditionGroup,
  path: ConditionPath,
): ConditionGroup {
  const index = path.at(-1)!;
  return updateGroup(root, path.slice(0, -1), (group) => ({
    ...group,
    conditions: group.conditions.filter((_, at) => at !== index),
  }));
}

/** `root` with `child` appended to the group at `path`. */
export function appendAt(
  root: ConditionGroup,
  path: ConditionPath,
  child: EditorCondition,
): ConditionGroup {
  return updateGroup(root, path, (group) => ({
    ...group,
    conditions: [...group.conditions, child],
  }));
}

/** A condition of `kind` at its starting value, keeping the operator. */
export function freshCondition(
  kind: ConditionKind,
  negated: boolean,
): RowCondition {
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
export function asExpression(condition: FlatCondition): ExpressionCondition {
  return { kind: "expression", text: formatCondition(condition) };
}

/**
 * An expression row as a labelled row, when its text reads as one item-type,
 * Collection, or Tag test; `null` while it reads as anything else.
 */
export function asLabelled(
  condition: ExpressionCondition,
): FlatCondition | null {
  const compiled = compileCondition(condition.text).condition;
  return compiled && visuallyEditable(compiled) ? compiled : null;
}

/**
 * A new group takes the other match and one condition, so it starts as the
 * alternative or exception the user reached for.
 */
export function freshGroup(parent: GroupMatch): ConditionGroup {
  return {
    kind: "group",
    match: parent === "all" ? "any" : "all",
    conditions: [freshCondition("item-type", false)],
  };
}

/**
 * What keeps one row from being saved, as the user reads it. An expression
 * row answers through the same tree checks as the visual rows.
 */
export function conditionIssue(
  condition: RowCondition,
  deps: MatchEditorDeps,
): string | null {
  switch (condition.kind) {
    case "library": {
      const { problem } = compileCondition(
        formatCondition(condition),
        deps.libraries,
      );
      return problem ? describeProblem(problem) : null;
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
        ? m.settings_profile_match_collection_empty()
        : null;
    case "tags":
      return condition.operator !== "isEmpty" &&
        (condition.values.length === 0 ||
          condition.values.some((value) => value === ""))
        ? m.settings_profile_match_tag_empty()
        : null;
    case "expression": {
      const { condition: compiled, problem } = compileCondition(
        condition.text,
        deps.libraries,
      );
      if (problem) return describeProblem(problem);
      return treeIssue(asGroup(compiled), deps);
    }
  }
}

/** The first incomplete condition, as the user reads it. */
export function treeIssue(
  group: ConditionGroup,
  deps: MatchEditorDeps,
): string | null {
  for (const condition of group.conditions) {
    const issue =
      condition.kind === "group"
        ? treeIssue(condition, deps)
        : conditionIssue(condition, deps);
    if (issue) return issue;
  }
  return null;
}

/** Whether anything keeps the match from being saved. */
export function draftInvalid(
  draft: MatchDraft,
  deps: MatchEditorDeps,
): boolean {
  return treeIssue(draft.root, deps) !== null;
}
