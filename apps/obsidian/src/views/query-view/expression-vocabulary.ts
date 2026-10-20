// What a Query View's expression editors can read, a filter condition's and a
// Formula's: the names Expression Completion offers, each with the label the
// Properties popover gives its Property, and the receiver types the Signature
// Hint reads, as the dataset's planner types them.
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import {
  datasetExpressionFields,
  datasetReceiverType,
} from "@zotlit/workbench/language";
import type { ExpressionVocabulary } from "@zotlit/workbench/language";

import { DATASETS } from "./datasets";
import { formulaProperty, vaultProperty } from "./query-file";
import type { QueryFileDataset } from "./query-file";
import { fieldLabel } from "./view-properties";
import type { ViewProperties } from "./view-properties";

export function expressionVocabulary({
  dataset,
  properties,
  formulas = [],
  context = false,
  vaultNames,
}: {
  /** The dataset the expression reads. */
  dataset: QueryFileDataset;
  /**
   * The Properties of the view, whose labels name the entries; without
   * them, a field wears its own label.
   */
  properties?: ViewProperties | null;
  /** The names of the Formulas the expression can read. */
  formulas?: readonly string[];
  /** Whether the view binds a Query Context. */
  context?: boolean;
  /**
   * The vault properties a filter condition reads; absent in a Formula,
   * which ZotLit Query evaluates without the vault.
   */
  vaultNames?: readonly string[];
}): ExpressionVocabulary {
  const label = (path: string) =>
    properties?.entry(path).label ?? fieldLabel(path);
  const { engine } = DATASETS[dataset];
  return {
    fields: datasetExpressionFields(engine, label),
    receiverType: datasetReceiverType(engine),
    context,
    formulas: formulas.map((name) => ({
      name,
      label: label(formulaProperty(name)),
    })),
    ...(vaultNames && {
      vault: vaultNames.map((name) => ({
        name,
        label: label(vaultProperty(name)),
      })),
    }),
  };
}
