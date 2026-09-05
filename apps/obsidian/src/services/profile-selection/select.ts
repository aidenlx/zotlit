/**
 * Automatic Profile Selection — the matcher behind the Note Feature's
 * creation boundary.
 *
 * Rules run in user order over the Item's Library scope. A valid nonmatch
 * advances; the first match supplies the target selector and the rule that
 * explains it. Two outcomes stop automatic selection and require an explicit
 * choice instead: an in-scope rule the vault cannot evaluate (its expression
 * is outside the condition contract) and a matching rule whose target
 * Profile is unavailable. Rules outside the Item's Library scope contribute
 * nothing, not even a problem.
 *
 * Pure: the facts of the Item come in, a selection comes out. Later slices
 * widen {@link RuleItemFacts} with memberships resolved from the database.
 */
import type { Item } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { selectorKey } from "@/services/library-scope/scope";
import type { LibrarySelector } from "@/services/library-scope/scope";

import { compileCondition, matchCondition } from "./condition";
import type { ConditionProblem, RuleItemFacts } from "./condition";
import type { ProfileSelectionRule } from "./schema";

const logger = getLogger(["profile-selection"]);

/** What a rule reads of an Item: its Library, then the condition facts. */
export interface RuleItem extends RuleItemFacts {
  /** `null` for a group Library Zotero reports no group ID for. */
  library: LibrarySelector | null;
}

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

/** The facts of a database Item, as rules read them. */
export function ruleItem(item: Pick<Item, "groupID" | "fields">): RuleItem {
  return {
    library:
      item.groupID === null
        ? { type: "personal" }
        : { type: "group", groupID: item.groupID },
    itemType: item.fields.itemType,
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
  options: { isAvailable: (selector: ProfileSelector) => boolean },
): RuleSelection {
  for (const rule of rules) {
    if (!inScope(rule, item.library)) continue;
    const { condition, problem } = compileCondition(rule.expression);
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

function inScope(
  rule: ProfileSelectionRule,
  library: LibrarySelector | null,
): boolean {
  if (rule.scope.mode === "all") return true;
  if (library === null) return false;
  const key = selectorKey(library);
  return rule.scope.libraries.some((selector) => selectorKey(selector) === key);
}
