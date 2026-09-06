// UI seam for Profile Selection Rules: the words a rule, its problem, and an
// item type are shown by. Every settings row, picker badge, and notice reads
// the same summary, so the user recognises one rule across surfaces.
import { ITEM_TYPES } from "@zotlit/zotero-types/item-types";

import * as m from "@/lib/i18n/generated/messages";
import { runtime } from "@/lib/i18n/generated/runtime";
import { libraryLabel, selectorLabel } from "@/services/library-scope/label";
import type {
  AvailableLibrary,
  LibrarySelector,
} from "@/services/library-scope/scope";
import { selectorKey } from "@/services/library-scope/scope";

import { compileCondition, compileFilter } from "./condition";
import type {
  CollectionReference,
  ConditionProblem,
  FlatCondition,
  RuleCondition,
} from "./condition";
import type { CollectionChoice } from "./facts";
import type { ProfileSelectionRule, RuleFilter } from "./schema";

/** The display data a summary names Libraries and Collections by. */
export interface DescribeOptions {
  libraries?: readonly AvailableLibrary[];
  collections?: readonly CollectionChoice[];
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
 * One line naming what a rule matches and where: "Item type is Book in My
 * Library". Groups read as lists — "and" for all, "or" for any — with a
 * nested group in parentheses. An expression outside the contract is quoted
 * as written.
 * Without `libraries`, a selected Library reads by its stable selector;
 * without `collections`, a Collection reads by its Library and key.
 */
export function describeRule(
  rule: ProfileSelectionRule,
  options: DescribeOptions = {},
): string {
  return m.settings_profile_rule_summary({
    conditions: describeConditions(rule.filter, options),
    libraries: describeScope(rule, options.libraries ?? []),
  });
}

/** The reason a rule cannot be evaluated, for a settings row or a picker. */
export function describeProblem(
  problem: ConditionProblem,
  options: DescribeOptions = {},
): string {
  switch (problem.code) {
    case "empty":
      return m.profile_rule_problem_empty();
    case "syntax":
      return m.profile_rule_problem_syntax({ text: problem.text });
    case "unsupported":
      return m.profile_rule_problem_unsupported({ text: problem.text });
    case "unknown-item-type":
      return m.profile_rule_problem_unknown_item_type({ text: problem.text });
    case "unknown-library":
      return m.profile_rule_problem_unknown_library({ text: problem.text });
    case "missing-collection":
      return m.profile_rule_problem_missing_collection({
        collection: collectionLabel(problem, options),
      });
  }
}

/**
 * How a Collection reads: "My Library: Project / Drafts" when the database
 * offers it, else its Library and key — the same reference the rule stores.
 */
export function collectionLabel(
  reference: CollectionReference,
  options: DescribeOptions = {},
): string {
  const key = selectorKey(reference.library);
  const library = options.libraries?.find(
    (candidate) => selectorKey(candidate.selector) === key,
  );
  const choice = options.collections?.find(
    (candidate) =>
      selectorKey(candidate.library) === key && candidate.key === reference.key,
  );
  return m.settings_profile_rule_collection_label({
    library: library ? libraryLabel(library) : selectorLabel(reference.library),
    path: choice ? choice.path.join(" / ") : reference.key,
  });
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
    case "item-type": {
      const type = itemTypeLabel(condition.values[0]);
      return condition.negated
        ? m.settings_profile_rule_item_type_is_not({ type })
        : m.settings_profile_rule_item_type_is({ type });
    }
    case "collection": {
      const collection = collectionLabel(condition, options);
      if (condition.descendants)
        return condition.negated
          ? m.settings_profile_rule_not_in_collection({ collection })
          : m.settings_profile_rule_in_collection({ collection });
      return condition.negated
        ? m.settings_profile_rule_not_in_collection_direct({ collection })
        : m.settings_profile_rule_in_collection_direct({ collection });
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

function describeScope(
  rule: ProfileSelectionRule,
  libraries: readonly AvailableLibrary[],
): string {
  if (rule.scope.mode === "all") return m.settings_library_scope_all();
  const byKey = new Map(
    libraries.map((library) => [selectorKey(library.selector), library]),
  );
  return new Intl.ListFormat(runtime.getLocale(), {
    type: "conjunction",
  }).format(
    rule.scope.libraries.map((selector) => scopeLabel(selector, byKey)),
  );
}

function scopeLabel(
  selector: LibrarySelector,
  byKey: ReadonlyMap<string, AvailableLibrary>,
): string {
  const library = byKey.get(selectorKey(selector));
  return library ? libraryLabel(library) : selectorLabel(selector);
}
