import type { ConditionProblem } from "#/match/condition";

// Localized explanations for the shared Match evaluator diagnostics.
import type { WorkbenchMessages } from "./generated/messages";

export function describeProblem(
  m: WorkbenchMessages,
  problem: ConditionProblem,
): string {
  switch (problem.code) {
    case "empty":
      return m.workbench_match_problem_empty();
    case "syntax":
      return m.workbench_match_problem_syntax({ text: problem.text });
    case "unsupported":
      return m.workbench_match_problem_unsupported({ text: problem.text });
    case "unknown-library":
      return m.workbench_match_problem_unknown_library({ text: problem.text });
    case "unknown-item-type":
      return m.workbench_match_problem_unknown_item_type({
        text: problem.text,
      });
  }
}
