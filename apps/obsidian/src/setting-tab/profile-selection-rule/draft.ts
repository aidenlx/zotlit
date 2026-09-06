// The rule editor's draft and the pure operations over it: what a fresh rule
// starts as, how the condition tree changes, and what keeps a draft from
// being saved. The stored Filter Expression is the one source; the visual
// surface edits `root` and writes the canonical expression back on every
// change, so an expression the user has not touched stays as written.
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
} from "@/services/profile-selection";

/** What a fresh condition tests: the type the ticketed example starts from. */
export const DEFAULT_ITEM_TYPE = "book";

export type ConditionKind = FlatCondition["kind"];
export type ConditionGroup = Extract<RuleCondition, { kind: "group" }>;
export type GroupMatch = ConditionGroup["match"];

/** A child's position in the tree: the index at each nesting level. */
export type ConditionPath = readonly number[];

export interface RuleDraft {
  profile: ProfileSelector;
  scope: LibraryScope;
  expression: string;
  /** The tree the visual surface shows; `null` on the expression surface. */
  root: ConditionGroup | null;
}

/** What the editor reads from the plugin while it is open. */
export interface RuleEditorDeps {
  profiles: readonly { id: ProfileSelector; label: string }[];
  libraries: readonly AvailableLibrary[];
  /** The Collections the database offers, read once when the dialog opens. */
  collections: readonly CollectionChoice[];
}

/**
 * A new rule opens on the visual surface with one item-type condition. An
 * existing rule opens there when its expression is inside the contract, and
 * on the expression surface — text intact, problem shown — otherwise.
 */
export function initialDraft(rule?: ProfileSelectionRule): RuleDraft {
  if (!rule) {
    const root: ConditionGroup = {
      kind: "group",
      match: "all",
      conditions: [
        { kind: "item-type", negated: false, itemType: DEFAULT_ITEM_TYPE },
      ],
    };
    return {
      profile: "default",
      scope: { mode: "all" },
      expression: formatCondition(root),
      root,
    };
  }
  const { condition } = compileCondition(rule.expression);
  return {
    profile: rule.profile,
    scope: rule.scope,
    expression: rule.expression,
    root: condition && asGroup(condition),
  };
}

/** The tree the visual surface edits: a lone condition sits in a "Match all" group. */
export function asGroup(condition: RuleCondition): ConditionGroup {
  return condition.kind === "group"
    ? condition
    : { kind: "group", match: "all", conditions: [condition] };
}

/**
 * Whether a group holds nothing to judge. An empty root "Match all" group
 * is the deliberate catch-all; an empty "Match any" group or an empty nested
 * group has no expression form and is refused.
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
  next: RuleCondition,
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
  child: RuleCondition,
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

/** What keeps one condition from being saved, as the user reads it. */
export function conditionIssue(
  condition: FlatCondition,
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
  }
}

/**
 * What a condition's own row says about it: the row names a missing
 * Collection in its own words, since the dropdown beside it already shows
 * which Collection that is.
 */
export function rowIssue(
  condition: FlatCondition,
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

/**
 * What keeps the current expression from being a rule: a contract problem
 * in the text, or a condition the tree cannot be saved with. `null` when
 * the expression is complete. Both surfaces answer through the same tree
 * checks, so the expression editor refuses what the visual editor flags.
 */
export function expressionIssue(
  draft: RuleDraft,
  deps: RuleEditorDeps,
): string | null {
  const { root, expression } = draft;
  if (root) return treeIssue(root, true, deps);
  const { condition, problem } = compileCondition(expression);
  if (problem) return describeProblem(problem, describeOptions(deps));
  return treeIssue(asGroup(condition), true, deps);
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
    scopeIssue(draft.scope) !== null || expressionIssue(draft, deps) !== null
  );
}
