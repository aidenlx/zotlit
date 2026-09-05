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

import { compileCondition, flatConditions } from "./condition";
import type { ConditionProblem } from "./condition";
import type { ProfileSelectionRule } from "./schema";

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
 * Library". An expression the flat editor cannot show is quoted as written.
 * Without `libraries`, a selected Library reads by its stable selector.
 */
export function describeRule(
  rule: ProfileSelectionRule,
  options: { libraries?: readonly AvailableLibrary[] } = {},
): string {
  return m.settings_profile_rule_summary({
    conditions: describeConditions(rule.expression),
    libraries: describeScope(rule, options.libraries ?? []),
  });
}

/** The reason a rule cannot be evaluated, for a settings row or a picker. */
export function describeProblem(problem: ConditionProblem): string {
  switch (problem.code) {
    case "syntax":
      return m.profile_rule_problem_syntax({ text: problem.text });
    case "unsupported":
      return m.profile_rule_problem_unsupported({ text: problem.text });
    case "unknown-item-type":
      return m.profile_rule_problem_unknown_item_type({ text: problem.text });
  }
}

function describeConditions(expression: string): string {
  const { condition } = compileCondition(expression);
  const flat = condition && flatConditions(condition);
  if (!flat) return expression.trim();
  if (flat.length === 0) return m.settings_profile_rule_summary_all_items();
  return new Intl.ListFormat(runtime.getLocale(), {
    type: "conjunction",
  }).format(
    flat.map(({ negated, itemType }) =>
      negated
        ? m.settings_profile_rule_item_type_is_not({
            type: itemTypeLabel(itemType),
          })
        : m.settings_profile_rule_item_type_is({
            type: itemTypeLabel(itemType),
          }),
    ),
  );
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
