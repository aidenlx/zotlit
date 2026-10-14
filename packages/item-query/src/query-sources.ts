// Query Sources owns the lazy source reads shared by every loader of a query.
import { Effect } from "effect";

import {
  readCollectionPaths,
  readFieldVocabulary,
} from "@zotlit/db/item-query";
import type { CollectionPaths, FieldVocabulary } from "@zotlit/db/item-query";

import type { CandidateSources } from "./candidate-plan";
import type { QueryDataset } from "./dataset";
import { ItemQueryError } from "./error";
import type { ItemQueryErrorLocation } from "./error";
import type { ItemQueryFault, Span } from "./fault";
import type { FilterPlan } from "./filter-plan";
import type { LoadRequest } from "./record-loader";
import type { TargetLibrary } from "./request";

/** Each query runs sequentially in one fiber. Cache only completed reads. */
export const openQuerySources = Effect.sync(() => {
  let fields: FieldVocabulary | undefined;
  const paths = new Map<number, CollectionPaths>();
  const readVocabulary = Effect.fnUntraced(function* () {
    if (!fields) fields = yield* readFieldVocabulary();
    return fields;
  });
  const collectionPaths = Effect.fnUntraced(function* (library: TargetLibrary) {
    const found = paths.get(library.libraryID);
    if (found) return found;
    const loaded = yield* readCollectionPaths(library);
    paths.set(library.libraryID, loaded);
    return loaded;
  });
  const checkCustomFields = Effect.fnUntraced(function* (
    plan: LoadRequest<unknown>,
  ) {
    const { dataset, filter, paths, group, formulas = [] } = plan;
    if (
      !filter?.customFields.length &&
      !formulas.some((formula) => formula.plan.customFields.length) &&
      !paths.some((path) => path.customField !== null) &&
      !(group && group.customField !== null)
    )
      return;
    const vocabulary = yield* readVocabulary();
    const known = new Set(vocabulary.customFieldNames);
    /** The custom fields of a Filter Expression: the filter or a Formula. */
    const expressionUses = (
      uses: NonNullable<typeof filter>["customFields"],
      at: Pick<ItemQueryErrorLocation, "argument" | "path">,
      argumentText: string,
    ) =>
      uses.map((use): CustomFieldUse => {
        const { at: span, ...read } = expressionUse(use, known);
        return { ...read, location: { ...at, span }, argumentText };
      });
    // The filter first, then the Projection Paths and the Formulas.
    const customFields: CustomFieldUse[] = [
      ...expressionUses(
        filter?.customFields ?? [],
        { argument: "filter" },
        plan.query.filter ?? "",
      ),
      ...paths.flatMap(({ customField: name, text }): CustomFieldUse[] =>
        name === null
          ? []
          : [
              {
                name,
                bare: false,
                location: {
                  argument: "fields",
                  index: plan.query.fields.indexOf(text),
                  path: `fields[${plan.query.fields.indexOf(text)}]`,
                },
                argumentText: JSON.stringify(plan.query.fields),
              },
            ],
      ),
      ...(group && group.customField !== null
        ? [
            {
              name: group.customField,
              bare: false,
              location: {
                argument: "group" as const,
                span: { from: 0, to: group.text.length },
              },
              argumentText: group.text,
            },
          ]
        : []),
      ...formulas.flatMap((formula) =>
        expressionUses(
          formula.plan.customFields,
          { argument: "formulas", path: formula.name },
          formula.text,
        ),
      ),
    ];
    const missing = customFields.find((use) => isMissing(use, known));
    if (missing) {
      return yield* unknownCustomField(
        dataset,
        vocabulary.customFieldNames,
        missing,
      );
    }
  });
  const sources = {
    vocabulary: readVocabulary,
    collectionPaths,
    checkCustomFields,
    /** The sources already demanded by the request, for synchronous leaf lowering. */
    candidateContext: (library: TargetLibrary): CandidateSources => ({
      library,
      vocabulary: fields ?? null,
      collectionPaths: paths.get(library.libraryID),
    }),
  };
  return sources;
});
export type QuerySources = Effect.Success<typeof openQuerySources>;

/** A custom field that an expression names, as the source reads it. */
interface ExpressionUse {
  readonly name: string;
  /** The filter names it with its bare form. */
  readonly bare: boolean;
  readonly deferred?: Extract<ItemQueryFault, { kind: "unknown" }>;
  readonly dotted?: boolean;
  /** Where the expression text names it. */
  readonly at: Span;
}

/** A custom field that the request names, and where it names it. */
interface CustomFieldUse extends Omit<ExpressionUse, "at"> {
  readonly location: ItemQueryErrorLocation;
  readonly argumentText?: string;
}

/**
 * A custom field use of a Filter Expression against the custom fields `known`
 * of the source: a property chain whose prefix the source defines is a use of
 * that prefix.
 */
function expressionUse(
  {
    name,
    bare,
    from,
    to,
    deferred,
    dotted,
  }: FilterPlan["customFields"][number],
  known: ReadonlySet<string>,
): ExpressionUse {
  return dotted && !known.has(name) && known.has(dotted.name)
    ? {
        name: dotted.name,
        bare,
        dotted: true,
        at: { from: dotted.from, to: dotted.to },
      }
    : { name, bare, deferred, at: { from, to } };
}

/** Whether the source lacks the custom field of `use`. */
function isMissing(
  { name, deferred, dotted }: Omit<ExpressionUse, "at">,
  known: ReadonlySet<string>,
): boolean {
  return Boolean(dotted || deferred || !known.has(name));
}

/**
 * The Fault of a custom field use that the source lacks. A bare name outside
 * the built-in names is a custom field of the source or an unknown field.
 */
function missingFault(
  names: readonly string[],
  { name, bare, deferred, dotted }: Omit<ExpressionUse, "at">,
  at: Span,
): ItemQueryFault {
  return deferred && !names.includes(name)
    ? deferred
    : {
        kind: "unknown",
        role: bare && !deferred && !dotted ? "field" : "custom-field",
        name,
        at,
        customFields: names,
        ...(deferred || dotted ? { dotted: true } : {}),
      };
}

/**
 * The first custom field that the Filter Expression of `plan` names and the
 * source, with the custom fields `names`, lacks, as a Fault at its text; null
 * when the source has each.
 */
export function missingCustomField(
  plan: Pick<FilterPlan, "customFields">,
  names: readonly string[],
): { readonly fault: ItemQueryFault; readonly at: Span } | null {
  const known = new Set(names);
  for (const use of plan.customFields) {
    const read = expressionUse(use, known);
    if (isMissing(read, known))
      return { fault: missingFault(names, read, read.at), at: read.at };
  }
  return null;
}

/** A custom field that the source does not define fails the query. */
function unknownCustomField(
  dataset: QueryDataset<any>,
  names: readonly string[],
  use: CustomFieldUse,
): Effect.Effect<never, ItemQueryError> {
  const { location, argumentText } = use;
  return Effect.fail(
    new ItemQueryError({
      dataset,
      location,
      ...(argumentText === undefined ? {} : { argumentText }),
      fault: missingFault(names, use, location.span ?? { from: 0, to: 0 }),
    }),
  );
}
