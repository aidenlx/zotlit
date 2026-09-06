// UI seam for Profile Selection Rules: the words a rule, its problem, and an
// item type are shown by. Every settings row, picker badge, and notice reads
// the same summary, so the user recognises one rule across surfaces.
import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import { libraryLabel, selectorLabel } from "@/services/library-scope/label";
import type { AvailableLibrary } from "@/services/library-scope/scope";
import { selectorKey } from "@/services/library-scope/scope";

import { compileCondition, compileFilter } from "./condition";
import type {
  ConditionProblem,
  FlatCondition,
  RuleCondition,
} from "./condition";
import type { ProfileSelectionRule, RuleFilter } from "./schema";

/** The display data a summary uses to name Libraries. */
export interface DescribeOptions {
  libraries?: readonly AvailableLibrary[];
}

/** The label of a built-in Zotero item type in the active locale. */
export function itemTypeLabel(name: string): string {
  const entry = ITEM_TYPES.find((itemType) => itemType.name === name);
  if (!entry) return name;
  return runtime.getLocale() === "zh-CN"
    ? entry.labels["zh-CN"]
    : entry.labels["en-US"];
}

/**
 * One line naming what a rule matches: "Library is My Library and item type
 * is Book". Groups read as lists — "and" for all, "or" for any — with a
 * nested group in parentheses. An expression outside the contract is quoted
 * as written.
 * Without `libraries`, a selected Library reads by its stable selector.
 */
export function describeRule(
  rule: ProfileSelectionRule,
  options: DescribeOptions = {},
): string {
  return describeConditions(rule.filter, options);
}

/** The reason a rule cannot be evaluated, for a settings row or a picker. */
export function describeProblem(problem: ConditionProblem): string {
  switch (problem.code) {
    case "empty":
      return m.profile_rule_problem_empty();
    case "syntax":
      return m.profile_rule_problem_syntax({ text: problem.text });
    case "unsupported":
      return m.profile_rule_problem_unsupported({ text: problem.text });
    case "unknown-library":
      return m.profile_rule_problem_unknown_library({ text: problem.text });
    case "unknown-item-type":
      return m.profile_rule_problem_unknown_item_type({ text: problem.text });
  }
}

function describeConditions(
  filter: RuleFilter,
  options: DescribeOptions,
): string {
  const { condition } = compileFilter(filter);
  if (!condition) return describeFilter(filter, options);
  if (condition.kind === "group" && condition.conditions.length === 0)
    return m.settings_profile_rule_summary_all_items();
  return describeCondition(condition, options);
}

/** A broken filter, leaf by leaf: readable leaves in words, the rest as written. */
function describeFilter(filter: RuleFilter, options: DescribeOptions): string {
  if (typeof filter === "string") {
    const { condition } = compileCondition(filter);
    return condition ? describeCondition(condition, options) : filter.trim();
  }
  const all = "and" in filter;
  return new Intl.ListFormat(runtime.getLocale(), {
    type: all ? "conjunction" : "disjunction",
  }).format(
    (all ? filter.and : filter.or).map((entry) =>
      typeof entry === "string"
        ? describeFilter(entry, options)
        : m.settings_profile_rule_summary_group({
            conditions: describeFilter(entry, options),
          }),
    ),
  );
}

function describeCondition(
  condition: RuleCondition,
  options: DescribeOptions,
): string {
  if (condition.kind !== "group") return describeFlat(condition, options);
  return new Intl.ListFormat(runtime.getLocale(), {
    type: condition.match === "all" ? "conjunction" : "disjunction",
  }).format(
    condition.conditions.map((entry) =>
      entry.kind === "group"
        ? m.settings_profile_rule_summary_group({
            conditions: describeCondition(entry, options),
          })
        : describeFlat(entry, options),
    ),
  );
}

function describeFlat(
  condition: FlatCondition,
  options: DescribeOptions,
): string {
  switch (condition.kind) {
    case "library": {
      const found = options.libraries?.find(
        ({ selector }) => selectorKey(selector) === condition.values[0],
      );
      const library = found
        ? libraryLabel(found)
        : selectorLabel(
            condition.values[0] === "personal"
              ? { type: "personal" }
              : {
                  type: "group",
                  groupID: Number(condition.values[0].slice(6)),
                },
          );
      return condition.negated
        ? m.settings_profile_rule_library_is_not({ library })
        : m.settings_profile_rule_library_is({ library });
    }
    case "item-type": {
      const type = itemTypeLabel(condition.values[0]);
      return condition.negated
        ? m.settings_profile_rule_item_type_is_not({ type })
        : m.settings_profile_rule_item_type_is({ type });
    }
    case "collections": {
      const collections = new Intl.ListFormat(runtime.getLocale()).format(
        condition.values.map((path) => path.join("/")),
      );
      switch (condition.operator) {
        case "within":
          return condition.negated
            ? m.settings_profile_rule_collections_not_inside({ collections })
            : m.settings_profile_rule_collections_inside({ collections });
        case "contains":
          return condition.negated
            ? m.settings_profile_rule_collections_are_not({ collections })
            : m.settings_profile_rule_collections_are({ collections });
        case "containsAny":
          return condition.negated
            ? m.settings_profile_rule_collections_are_not_any_of({
                collections,
              })
            : m.settings_profile_rule_collections_are_any_of({ collections });
        case "containsAll":
          return condition.negated
            ? m.settings_profile_rule_collections_are_not_all_of({
                collections,
              })
            : m.settings_profile_rule_collections_are_all_of({ collections });
        case "isEmpty":
          return condition.negated
            ? m.settings_profile_rule_collections_are_not_empty()
            : m.settings_profile_rule_collections_are_empty();
      }
    }
    case "tags": {
      const tags = new Intl.ListFormat(runtime.getLocale()).format(
        condition.values,
      );
      switch (condition.operator) {
        case "contains":
          return condition.negated
            ? m.settings_profile_rule_tags_do_not_contain({ tags })
            : m.settings_profile_rule_tags_contain({ tags });
        case "containsAny":
          return condition.negated
            ? m.settings_profile_rule_tags_do_not_contain_any({ tags })
            : m.settings_profile_rule_tags_contain_any({ tags });
        case "containsAll":
          return condition.negated
            ? m.settings_profile_rule_tags_do_not_contain_all({ tags })
            : m.settings_profile_rule_tags_contain_all({ tags });
        case "isEmpty":
          return condition.negated
            ? m.settings_profile_rule_tags_are_not_empty()
            : m.settings_profile_rule_tags_are_empty();
      }
    }
  }
}
