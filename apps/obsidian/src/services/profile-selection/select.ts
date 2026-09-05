// Automatic Profile Selection: the pure matcher behind the Note Feature's creation boundary.
//
// Rules run in user order over the Item's Library scope. A valid nonmatch
// advances; the first match supplies the target selector and the rule that
// explains it. Three outcomes stop automatic selection and require an
// explicit choice instead: an in-scope rule the vault cannot evaluate (its
// expression is outside the condition contract), an in-scope rule that
// refers to a Collection the database does not hold, and a matching rule
// whose target Profile is unavailable. Rules outside the Item's Library
// scope contribute nothing, not even a problem.
//
// The facts of the Item come in, a selection comes out. The database takes
// part only through the two lookups the caller injects.
import type { Item } from "@zotlit/db";

import { getLogger } from "@/lib/log";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { selectorKey } from "@/services/library-scope/scope";
import type { LibrarySelector } from "@/services/library-scope/scope";

import {
  collectionReferences,
  compileCondition,
  matchCondition,
} from "./condition";
import type {
  CollectionReference,
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
 * from the Item row, its memberships from `resolveMembershipFacts`.
 */
export function ruleItem(
  item: Pick<Item, "groupID" | "fields">,
  memberships: Pick<
    RuleItemFacts,
    "tags" | "collections" | "collectionAncestors"
  >,
): RuleItem {
  return {
    library:
      item.groupID === null
        ? { type: "personal" }
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
 * @param options.hasCollection whether the database holds a referenced
 * Collection — a missing one breaks the rule instead of failing to match.
 */
export function selectProfileByRules(
  rules: readonly ProfileSelectionRule[],
  item: RuleItem,
  options: {
    isAvailable: (selector: ProfileSelector) => boolean;
    hasCollection: (reference: CollectionReference) => boolean;
  },
): RuleSelection {
  for (const rule of rules) {
    if (!inScope(rule, item.library)) continue;
    const { condition, problem } = diagnoseRule(rule, options);
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
 * Whether a rule can be evaluated: its expression compiles and every
 * Collection it refers to exists. The settings list shows the same problem
 * the evaluator would stop on, so a rule is repaired where it is edited.
 */
export function diagnoseRule(
  rule: Pick<ProfileSelectionRule, "expression">,
  options: { hasCollection: (reference: CollectionReference) => boolean },
): CompiledCondition {
  const compiled = compileCondition(rule.expression);
  if (compiled.problem) return compiled;
  const missing = collectionReferences(compiled.condition).find(
    (reference) => !options.hasCollection(reference),
  );
  return missing
    ? { condition: null, problem: { code: "missing-collection", ...missing } }
    : compiled;
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
