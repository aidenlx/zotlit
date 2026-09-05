// The persisted shape of Profile Selection Rules: one vault-owned ordered list, priority order being list order.
//
// Each rule records an explicit Library scope (the same stable selectors
// Library Scope persists), one Filter Expression, and one target Profile
// selector. The expression is stored as text: its validity against the
// supported condition contract is judged when a rule is edited or evaluated
// (`condition.ts`), so a rule that a later version cannot read stays on disk
// for the user to repair rather than being dropped by the settings load.
// See docs/adr/0038-profile-selection-rules-belong-to-the-vault.md.
import * as v from "valibot";

import { parseProfileSelector } from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { libraryScopeSchema } from "@/services/library-scope/scope";

export const PROFILE_SELECTION_RULES_KEY = "profile.selection-rules";

const profileSelector = v.custom<ProfileSelector>(
  (value) =>
    typeof value === "string" && parseProfileSelector(value) !== undefined,
  "Profile selector must be a Profile ID or `default`",
);

export const profileSelectionRuleSchema = v.pipe(
  v.object({
    /** Stable identity of the rule inside this vault's list. */
    id: v.pipe(v.string(), v.nonEmpty()),
    scope: libraryScopeSchema,
    /** The Filter Expression the rule's conditions are stored as. */
    expression: v.string(),
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
