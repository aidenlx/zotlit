// Automatic Profile Selection: the pure matcher behind the Note Feature's creation boundary.
//
// Rules run in user order. A valid nonmatch advances; the first match supplies
// the target selector and the rule that explains it. An unevaluable rule or
// a matching rule whose target Profile is unavailable requires an explicit
// choice instead. Library membership is tested by the filter itself.
//
// The facts of the Item come in, a selection comes out. The database takes
// part only through the Profile lookup the caller injects.
import { USER_LIBRARY_ID } from "@zotlit/db";
import type { Item } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import type { ProfileSelector } from "@/lib/profile-stamp";
import type { AvailableLibrary } from "@/services/library-scope/scope";

import { compileFilter, matchCondition } from "./condition";
import type {
  CompiledCondition,
  ConditionProblem,
  RuleItemFacts,
} from "./condition";
import type { ProfileSelectionRule } from "./schema";

const logger = getLogger(["profile-selection"]);

/** What a rule reads of an Item: its Library, type, and memberships. */
export type RuleItem = RuleItemFacts;

export type RuleSelection =
  | {
      outcome: "matched";
      rule: ProfileSelectionRule;
      selector: ProfileSelector;
    }
  | { outcome: "unmatched" }
  | { outcome: "broken"; rule: ProfileSelectionRule; problem: ConditionProblem }
  | {
      outcome: "unavailable-target";
      rule: ProfileSelectionRule;
      selector: ProfileSelector;
    };

/**
 * The facts of a database Item, as rules read them: its Library and type
 * from the Item row, its memberships from `resolveMembershipFacts`. An Item
 * of a Library that is neither the user Library nor a known group has no
 * Library selector; it still supplies its other facts to rules.
 */
export function ruleItem(
  item: Pick<Item, "libraryID" | "groupID" | "fields">,
  memberships: Pick<RuleItemFacts, "tags" | "collections">,
): RuleItem {
  return {
    library:
      item.libraryID === USER_LIBRARY_ID
        ? { type: "personal" }
        : item.groupID === null
          ? null
          : { type: "group", groupID: item.groupID },
    itemType: item.fields.itemType,
    ...memberships,
  };
}

/**
 * Select a Profile for a new Literature Note from the first matching rule.
 *
 * @param options.isAvailable whether a selector resolves to a Profile now —
 * the registry's answer, so an unavailable target is reported, never used.
 */
export function selectProfileByRules(
  rules: readonly ProfileSelectionRule[],
  item: RuleItem,
  options: {
    isAvailable: (selector: ProfileSelector) => boolean;
    libraries: readonly AvailableLibrary[];
  },
): RuleSelection {
  for (const rule of rules) {
    const { condition, problem } = diagnoseRule(rule, options.libraries);
    if (problem) {
      logger.debug("Profile Selection Rule {id} cannot be evaluated", {
        id: rule.id,
        problem,
      });
      return { outcome: "broken", rule, problem };
    }
    if (!matchCondition(condition, item)) {
      logger.trace("Profile Selection Rule {id} did not match", {
        id: rule.id,
      });
      continue;
    }
    if (!options.isAvailable(rule.profile)) {
      logger.debug(
        "Profile Selection Rule {id} targets an unavailable Profile",
        {
          id: rule.id,
          selector: rule.profile,
        },
      );
      return { outcome: "unavailable-target", rule, selector: rule.profile };
    }
    logger.debug("Profile Selection Rule {id} selected {selector}", {
      id: rule.id,
      selector: rule.profile,
    });
    return { outcome: "matched", rule, selector: rule.profile };
  }
  return { outcome: "unmatched" };
}

/**
 * Whether a rule can be evaluated: its filter compiles against the contract.
 */
export function diagnoseRule(
  rule: Pick<ProfileSelectionRule, "filter">,
  libraries: readonly AvailableLibrary[],
): CompiledCondition {
  return compileFilter(rule.filter, libraries);
}
