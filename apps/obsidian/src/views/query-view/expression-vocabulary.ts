// What a Query View's expression editors can read, a filter condition's and a
// Formula's: the names Expression Completion offers, each with the label the
// Properties popover gives its Property, and the receivers after a `.`, which
// the member list and the Signature Hint read, as the dataset's planner reads
// them with the view's Formulas and Query Context.
// @see apps/obsidian/docs/adr/0070-vault-properties-are-answered-outside-zotlit-query.md
import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { useMemo } from "react";

import type { ContextRecord } from "@zotlit/item-query";
import { datasetVocabulary } from "@zotlit/workbench/language";
import type { ExpressionVocabulary } from "@zotlit/workbench/language";

import { customFieldNamesAtom } from "./atoms";
import { boundRecords } from "./context-hint";
import { datasetSpec } from "./datasets";
import { useQueryViewState } from "./model";
import type { QueryFileDataset } from "./query-file";
import type { QueryView } from "./view";
import { fieldLabel } from "./view-properties";
import type { ViewProperties } from "./view-properties";

/** No custom fields, the same list each render. */
const NO_CUSTOM: readonly string[] = [];
const noCustomAtom = Atom.make(AsyncResult.success(NO_CUSTOM));

/**
 * The custom fields of the Zotero source, read while `reading` is true; the
 * read stops when it turns false or the editor unmounts. None until the
 * first read arrives.
 */
export function useViewCustomFields(reading = true): readonly string[] {
  const read = useAtomValue(reading ? customFieldNamesAtom : noCustomAtom);
  return Option.getOrElse(AsyncResult.value(read), () => NO_CUSTOM);
}

export function expressionVocabulary({
  dataset,
  properties,
  formulas = {},
  context = [],
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
  /** The records the view's Query Context binds. */
  context?: readonly ContextRecord[];
  /**
   * The vault properties a filter condition reads; absent in a Formula,
   * which ZotLit Query evaluates without the vault.
   */
  vaultNames?: readonly string[];
  /** The custom fields of the Zotero source, once they are read. */
  custom?: readonly string[];
}): ExpressionVocabulary {
  return datasetVocabulary(datasetSpec(dataset).engine, {
    label: (path) => properties?.entry(path).label ?? fieldLabel(path),
    formulas,
    context,
    ...(vaultNames && { vault: vaultNames }),
    ...(custom && { custom }),
  });
}

/**
 * The vocabulary of a view's filter conditions, per dataset: its Formulas,
 * the records its host binds, the custom fields of the source while
 * `reading`, and the vault properties a view of Items reads. One vocabulary
 * per dataset while these hold, so a receiver's planned members outlive a
 * keystroke.
 */
export function useFilterExpressions(
  view: QueryView,
  properties: ViewProperties | null,
  { reading, vaultNames }: { reading: boolean; vaultNames?: readonly string[] },
): (dataset: QueryFileDataset) => ExpressionVocabulary {
  const formulas = useQueryViewState(view, (s) => s.file?.formulas);
  const custom = useViewCustomFields(reading);
  const context = boundRecords(view.contextSource);
  return useMemo(() => {
    const made = new Map<QueryFileDataset, ExpressionVocabulary>();
    return (dataset) => {
      let vocabulary = made.get(dataset);
      if (!vocabulary) {
        vocabulary = expressionVocabulary({
          dataset,
          properties,
          formulas: formulas ?? {},
          context,
          custom,
          // Only a view of Items reads vault properties.
          ...(dataset === "items" && vaultNames && { vaultNames }),
        });
        made.set(dataset, vocabulary);
      }
      return vocabulary;
    };
  }, [properties, formulas, context, custom, vaultNames]);
}
