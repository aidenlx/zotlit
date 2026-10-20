// What a Query View's expression editors can read, a filter condition's and a
// Formula's: the names Expression Completion offers, each with the label the
// Properties popover gives its Property, and the receivers after a `.`, which
// the member list and the Signature Hint read, as the dataset's planner reads
// them with the view's Formulas and Query Context.
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import { useEffect, useState } from "react";

import {
  datasetExpressionFields,
  datasetReceiver,
} from "@zotlit/workbench/language";
import type { ExpressionVocabulary } from "@zotlit/workbench/language";

import { getLogger } from "@/lib/log";

import { datasetSpec } from "./datasets";
import { formulaProperty, vaultProperty } from "./query-file";
import type { QueryFileDataset } from "./query-file";
import type { QueryView } from "./view";
import { fieldLabel } from "./view-properties";
import type { ViewProperties } from "./view-properties";

const logger = getLogger(["views", "query-view", "expression-vocabulary"]);

/**
 * The custom fields of the Zotero source, read once the editor mounts; none
 * until they arrive or when the source cannot answer.
 */
export function useCustomFieldNames(view: QueryView): readonly string[] {
  const [names, setNames] = useState<readonly string[]>([]);
  useEffect(() => {
    let current = true;
    view.customFieldNames().then(
      (read) => {
        if (current) setNames(read);
      },
      (error: unknown) => {
        logger.warn("The custom fields could not be read", { error });
      },
    );
    return () => {
      current = false;
    };
  }, [view]);
  return names;
}

export function expressionVocabulary({
  dataset,
  properties,
  formulas = {},
  context = false,
  vaultNames,
  custom,
}: {
  /** The dataset the expression reads; a view without one reads Annotations. */
  dataset: QueryFileDataset | undefined;
  /**
   * The Properties of the view, whose labels name the entries; without
   * them, a field wears its own label.
   */
  properties?: ViewProperties | null;
  /** The Formulas the expression can read, each name with its text. */
  formulas?: Readonly<Record<string, string>>;
  /** Whether the view binds a Query Context. */
  context?: boolean;
  /**
   * The vault properties a filter condition reads; absent in a Formula,
   * which ZotLit Query evaluates without the vault.
   */
  vaultNames?: readonly string[];
  /** The custom fields of the Zotero source, once they are read. */
  custom?: readonly string[];
}): ExpressionVocabulary {
  const label = (path: string) =>
    properties?.entry(path).label ?? fieldLabel(path);
  const { engine } = datasetSpec(dataset);
  return {
    fields: datasetExpressionFields(engine, label),
    receiver: datasetReceiver(engine, { context, formulas }),
    context,
    formulas: Object.keys(formulas).map((name) => ({
      name,
      label: label(formulaProperty(name)),
    })),
    ...(vaultNames && {
      vault: vaultNames.map((name) => ({
        name,
        label: label(vaultProperty(name)),
      })),
    }),
    // A dataset of an Item's children reads its Item's custom fields.
    ...(custom && {
      custom: { path: `${engine.customPrefix}custom`, names: custom },
    }),
  };
}
