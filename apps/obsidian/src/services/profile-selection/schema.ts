// The persisted shape of Profile Selection Rules: one vault-owned ordered list, priority order being list order.
//
// Each rule records one Rule Filter and one target Profile selector.
// Library membership is an ordinary condition inside that filter.
// The filter is an explicit `and` / `or` tree, in the shape of an Obsidian
// Bases `filters` block, whose leaves are Filter Expressions stored as text.
// A leaf's validity against the supported condition contract is judged when
// a rule is edited or evaluated (`condition.ts`), so a rule that a later
// version cannot read stays on disk for the user to repair rather than being
// dropped by the settings load.
// See docs/adr/0038-profile-selection-rules-belong-to-the-vault.md.
import * as v from "valibot";

import { parseProfileSelector } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";

export const PROFILE_SELECTION_RULES_KEY = "profile.selection-rules";

const profileSelector = v.custom<ProfileSelector>(
  (value) =>
    typeof value === "string" && parseProfileSelector(value) !== undefined,
  "Profile selector must be a Profile ID or `default`",
);

/**
 * The conditions of a rule: a Filter Expression, or a group that holds for
 * every (`and`) or at least one (`or`) of its entries. An empty `and` group
 * holds for every Item; an empty `or` group holds for none.
 */
export type RuleFilter =
  | string
  | { readonly and: readonly RuleFilter[] }
  | { readonly or: readonly RuleFilter[] };

export const ruleFilterSchema: v.GenericSchema<RuleFilter> = v.union([
  v.string(),
  v.pipe(
    v.strictObject({ and: v.array(v.lazy(() => ruleFilterSchema)) }),
    v.readonly(),
  ),
  v.pipe(
    v.strictObject({ or: v.array(v.lazy(() => ruleFilterSchema)) }),
    v.readonly(),
  ),
]);

export const profileSelectionRuleSchema = v.pipe(
  v.object({
    /** Stable identity of the rule inside this vault's list. */
    id: v.pipe(v.string(), v.nonEmpty()),
    /** The conditions the rule's match is judged by. */
    filter: ruleFilterSchema,
    /** The Profile the rule selects, by stable ID or `default`. */
    profile: profileSelector,
  }),
  v.readonly(),
);

export type ProfileSelectionRule = v.InferOutput<
  typeof profileSelectionRuleSchema
>;

export const profileSelectionRulesSchema = v.pipe(
  v.array(profileSelectionRuleSchema),
  v.checkItems(
    (rule, index, rules) =>
      rules.findIndex(({ id }) => id === rule.id) === index,
    "Duplicate rule id",
  ),
  v.readonly(),
);

export type ProfileSelectionRules = v.InferOutput<
  typeof profileSelectionRulesSchema
>;

export const DEFAULT_PROFILE_SELECTION_RULES: ProfileSelectionRules =
  Object.freeze([]);
