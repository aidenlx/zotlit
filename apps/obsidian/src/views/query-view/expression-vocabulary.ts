// What Expression Completion offers in a Query View's expression editors: a
// filter condition and a Formula. Every name wears the label the Properties
// popover gives its Property.
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import { datasetExpressionFields } from "@zotlit/workbench/language";
import type { ExpressionVocabulary } from "@zotlit/workbench/language";

import { DATASETS } from "./datasets";
import { formulaProperty, vaultProperty } from "./query-file";
import type { QueryFileDataset } from "./query-file";
import { fieldLabel } from "./view-properties";
import type { ViewProperties } from "./view-properties";

export function expressionVocabulary({
  dataset,
  properties,
  formulas,
  context,
  vaultNames,
}: {
  /** The dataset the expression reads. */
  dataset: QueryFileDataset;
  /** The Properties of the view, whose labels name the entries. */
  properties: ViewProperties | null;
  /** The names of the Formulas the expression can read. */
  formulas: readonly string[];
  /** Whether the view binds a Query Context. */
  context: boolean;
  /**
   * The vault properties a filter condition reads; absent in a Formula,
   * which ZotLit Query evaluates without the vault.
   */
  vaultNames?: readonly string[];
}): ExpressionVocabulary {
  const label = (path: string) =>
    properties?.entry(path).label ?? fieldLabel(path);
  return {
    fields: datasetExpressionFields(DATASETS[dataset].engine, label),
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
