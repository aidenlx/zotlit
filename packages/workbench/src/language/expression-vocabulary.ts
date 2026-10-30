// What an expression editor over one Query Dataset can read: the names
// Expression Completion offers, each with the label its host gives it, and
// the receivers after a `.`, which the member list and the Signature Hint
// read, as the dataset's planner reads them with the host's Formulas and
// Query Context. Every host builds its vocabulary here.
import { FORMULA_SEGMENT } from "@zotlit/item-query";
import type { ContextRecord, QueryDataset } from "@zotlit/item-query";

import { datasetCustomFields, VAULT_SEGMENT } from "./expression-options";
import type { ExpressionVocabulary } from "./expression-options";
import { datasetReceiver } from "./expression-receiver";
import { datasetExpressionFields } from "./filter-expression-completion";

/**
 * The vocabulary of an expression over `engine`. It keeps nothing that a
 * host's input changes, so a host keeps the vocabulary while what it reads
 * stays the same, and a receiver's planned members outlive a keystroke.
 */
export function datasetVocabulary(
  engine: QueryDataset<any>,
  {
    label,
    context = [],
    formulas = {},
    vault,
    custom,
  }: {
    /**
     * The label the host gives an entry, by its id: a field's path, a
     * member's full path, `formula.<name>` or `vault.<name>`.
     */
    label: (path: string) => string | undefined;
    /** The records the host's Query Context binds. */
    context?: readonly ContextRecord[];
    /** The Formulas the expression can read, each name with its text. */
    formulas?: Readonly<Record<string, string>>;
    /** The vault properties the expression reads; none in a Formula. */
    vault?: readonly string[];
    /** The custom fields of the Zotero source, once they are read. */
    custom?: readonly string[];
  },
): ExpressionVocabulary {
  const named = (name: string, id: string) => {
    const given = label(id);
    return given === undefined ? { name } : { name, label: given };
  };
  return {
    fields: datasetExpressionFields(engine, label),
    receiver: datasetReceiver(engine, { context, formulas, label }),
    context,
    formulas: Object.keys(formulas).map((name) =>
      named(name, `${FORMULA_SEGMENT}.${name}`),
    ),
    ...(vault && {
      vault: vault.map((name) => named(name, `${VAULT_SEGMENT}.${name}`)),
    }),
    ...(custom && { custom: datasetCustomFields(engine, custom) }),
  };
}
