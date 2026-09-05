// UI seam for a creation selection: the words its reason and its problem are
// shown by. Shared by the picker badge and the batch rows.
import * as m from "@/lib/i18n/generated/messages";
import { describeProblem, describeRule } from "@/services/profile-selection";

import type { CreationSelectionProblem } from "./operations";

/** Why automatic selection stopped, as the user reads it before choosing. */
export function describeSelectionProblem(
  problem: CreationSelectionProblem,
): string {
  switch (problem.kind) {
    case "broken-rule":
      return m.modal_profile_problem_broken_rule({
        rule: describeRule(problem.rule),
        problem: describeProblem(problem.problem),
      });
    case "unavailable-target":
      return m.modal_profile_problem_unavailable_target({
        rule: describeRule(problem.rule),
      });
    case "invalid-selector":
      return m.modal_profile_problem_invalid_selector({
        selector: problem.selector,
      });
  }
}
