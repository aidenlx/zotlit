// The rule editor's draft and the pure operations over it: what a fresh rule
// starts as, how the condition tree changes, how it reads from and writes to
// the stored Rule Filter, and what keeps a draft from being saved. The tree
// mirrors the filter: every group is an explicit `and` / `or`, and a leaf is
// a row — an item-type, Collection, or Tag condition when its expression
// reads as one, else the expression as written.
import * as m from "@/lib/i18n/generated/messages";
import type { ProfileSelector } from "@/lib/profile-stamp";
import type { AvailableLibrary } from "@/services/library-scope/scope";
import type { LibraryScope } from "@/services/library-scope/scope";
import {
  choicesLookup,
  compileCondition,
  describeProblem,
  formatCondition,
} from "@/services/profile-selection";
import type {
  CollectionChoice,
  DescribeOptions,
  FlatCondition,
  ProfileSelectionRule,
  RuleCondition,
  RuleFilter,
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

export interface RuleDraft {
  profile: ProfileSelector;
  scope: LibraryScope;
  root: ConditionGroup;
}

/** What the editor reads from the plugin while it is open. */
export interface RuleEditorDeps {
  profiles: readonly { id: ProfileSelector; label: string }[];
  libraries: readonly AvailableLibrary[];
  /** The Collections the database offers, read once when the dialog opens. */
  collections: readonly CollectionChoice[];
}

/** A new rule opens with one item-type condition; an existing rule opens on its filter. */
export function initialDraft(rule?: ProfileSelectionRule): RuleDraft {
  if (rule)
    return {
      profile: rule.profile,
      scope: rule.scope,
      root: fromFilter(rule.filter),
    };
  return {
    profile: "default",
    scope: { mode: "all" },
    root: {
      kind: "group",
      match: "all",
      conditions: [
        { kind: "item-type", negated: false, itemType: DEFAULT_ITEM_TYPE },
      ],
    },
  };
}

/**
 * The tree of a stored filter. A leaf that reads as one item-type,
 * Collection, or Tag test becomes that row; any other leaf — a blank, a
 * problem, or an expression that combines tests — stays as written in an
 * expression row. A lone leaf sits in a "Match all" group.
 */
export function fromFilter(filter: RuleFilter): ConditionGroup {
  const node = editorNode(filter);
  return node.kind === "group"
    ? node
    : { kind: "group", match: "all", conditions: [node] };
}

function editorNode(filter: RuleFilter): EditorCondition {
  if (typeof filter !== "string") {
    const all = "and" in filter;
    return {
      kind: "group",
      match: all ? "all" : "any",
      conditions: (all ? filter.and : filter.or).map(editorNode),
    };
  }
  const { condition } = compileCondition(filter);
  return condition && condition.kind !== "group"
    ? condition
    : { kind: "expression", text: filter };
}

/** The filter a tree stores: rows as canonical expressions, expression rows as typed. */
export function toFilter(group: ConditionGroup): RuleFilter {
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
export function asGroup(condition: RuleCondition): ConditionGroup {
  return condition.kind === "group"
    ? condition
    : { kind: "group", match: "all", conditions: [condition] };
}

/**
 * Whether a group holds nothing to judge. An empty root "Match all" group
 * is the deliberate catch-all; an empty "Match any" group or an empty nested
 * group has no meaning the user asked for and is refused.
 */
export function vacuous(group: ConditionGroup, isRoot: boolean): boolean {
  return group.conditions.length === 0 && (!isRoot || group.match === "any");
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
  collections: readonly CollectionChoice[],
): FlatCondition {
  switch (kind) {
    case "item-type":
      return { kind, negated, itemType: DEFAULT_ITEM_TYPE };
    case "collection": {
      const first = collections[0];
      return {
        kind,
        negated,
        library: first?.library ?? { type: "personal" },
        key: first?.key ?? "",
        descendants: true,
      };
    }
    case "tag":
      return { kind, negated, name: "" };
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
  return compiled && compiled.kind !== "group" ? compiled : null;
}

/**
 * A new group takes the other match and one condition, so it starts as the
 * alternative or exception the user reached for.
 */
export function freshGroup(
  parent: GroupMatch,
  collections: readonly CollectionChoice[],
): ConditionGroup {
  return {
    kind: "group",
    match: parent === "all" ? "any" : "all",
    conditions: [freshCondition("item-type", false, collections)],
  };
}

export function describeOptions(deps: RuleEditorDeps): DescribeOptions {
  return { libraries: deps.libraries, collections: deps.collections };
}

/**
 * What keeps one row from being saved, as the user reads it. An expression
 * row answers through the same tree checks as the visual rows, so it refuses
 * what they would flag — a Collection the database lacks included.
 */
export function conditionIssue(
  condition: RowCondition,
  deps: RuleEditorDeps,
): string | null {
  switch (condition.kind) {
    case "item-type":
      return null;
    case "collection":
      return choicesLookup(deps.collections)(condition)
        ? null
        : describeProblem(
            { code: "missing-collection", ...condition },
            describeOptions(deps),
          );
    case "tag":
      return condition.name === "" ? m.settings_profile_rule_tag_empty() : null;
    case "expression": {
      const { condition: compiled, problem } = compileCondition(condition.text);
      if (problem) return describeProblem(problem, describeOptions(deps));
      return treeIssue(asGroup(compiled), true, deps);
    }
  }
}

/**
 * What a condition's own row says about it: the row names a missing
 * Collection in its own words, since the dropdown beside it already shows
 * which Collection that is.
 */
export function rowIssue(
  condition: RowCondition,
  deps: RuleEditorDeps,
): string | null {
  if (
    condition.kind === "collection" &&
    !choicesLookup(deps.collections)(condition)
  )
    return deps.collections.length === 0
      ? m.settings_profile_rule_collection_none()
      : m.settings_profile_rule_collection_missing();
  return conditionIssue(condition, deps);
}

/** The first incomplete condition or vacuous group, as the user reads it. */
export function treeIssue(
  group: ConditionGroup,
  isRoot: boolean,
  deps: RuleEditorDeps,
): string | null {
  if (vacuous(group, isRoot)) return m.settings_profile_rule_group_empty();
  for (const condition of group.conditions) {
    const issue =
      condition.kind === "group"
        ? treeIssue(condition, false, deps)
        : conditionIssue(condition, deps);
    if (issue) return issue;
  }
  return null;
}

/** Whether the Libraries row refuses the draft. */
export function scopeIssue(scope: LibraryScope): string | null {
  return scope.mode === "selected" && scope.libraries.length === 0
    ? m.settings_profile_rule_scope_empty()
    : null;
}

/** Whether anything keeps the rule from being saved. */
export function draftInvalid(draft: RuleDraft, deps: RuleEditorDeps): boolean {
  return (
    scopeIssue(draft.scope) !== null ||
    treeIssue(draft.root, true, deps) !== null
  );
}
