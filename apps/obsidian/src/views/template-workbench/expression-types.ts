// What an expression field knows of a Query Dataset: the planner of the
// dataset types a method call's receiver, as a query plans it.
import type { QueryDataset } from "@zotlit/item-query";
import type { SignatureHintOptions } from "@zotlit/workbench/ui";

/**
 * The types of the expressions over a Query Dataset.
 * @param dataset The Query Dataset whose planner types a receiver.
 * @returns The receiver typing; a receiver that does not plan, or plans to a
 *   type known only at execution, is untyped.
 */
export function expressionTypes(
  dataset: Pick<QueryDataset, "planFilter">,
): SignatureHintOptions {
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
