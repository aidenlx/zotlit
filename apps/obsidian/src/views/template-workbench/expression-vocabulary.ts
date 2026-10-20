// What an expression field knows of a Query Dataset: the planner of the
// dataset types a method call's receiver, as a query plans it.
import type { QueryDataset } from "@zotlit/item-query";
import type { ExpressionVocabulary } from "@zotlit/workbench/ui";

/**
 * The vocabulary of the expression fields over `dataset`. A receiver that
 * does not plan, or plans to a type known only at execution, is untyped.
 */
export function expressionVocabulary(
  dataset: Pick<QueryDataset, "planFilter">,
): ExpressionVocabulary {
  return {
    receiverType: (text) => {
      const plan = dataset.planFilter(text);
      const root = "root" in plan ? plan.root : undefined;
      return root && "valueType" in root && root.valueType !== "unknown"
        ? root.valueType
        : undefined;
    },
  };
}
