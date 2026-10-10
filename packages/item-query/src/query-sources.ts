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
import type { ItemQueryFault } from "./fault";
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
    const { dataset, filter, paths, group } = plan;
    if (
      !filter?.customFields.length &&
      !paths.some((path) => path.customField !== null) &&
      !(group && group.customField !== null)
    )
      return;
    const vocabulary = yield* readVocabulary();
    const known = new Set(vocabulary.customFieldNames);
    // The filter first, then the Projection Paths.
    const customFields: CustomFieldUse[] = [
      ...(filter?.customFields ?? []).map(
        ({ name, bare, from, to, deferred, dotted }): CustomFieldUse =>
          dotted && !known.has(name) && known.has(dotted.name)
            ? {
                name: dotted.name,
                bare,
                dotted: true,
                location: {
                  argument: "filter",
                  span: { from: dotted.from, to: dotted.to },
                },
                argumentText: plan.query.filter ?? "",
              }
            : {
                name,
                bare,
                deferred,
                location: { argument: "filter", span: { from, to } },
                argumentText: plan.query.filter ?? "",
              },
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
    ];
    const missing = customFields.find(
      ({ name, deferred, dotted }) => dotted || deferred || !known.has(name),
    );
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

/** A custom field that the request names, and where it names it. */
interface CustomFieldUse {
  readonly name: string;
  /** The filter names it with its bare form. */
  readonly bare: boolean;
  readonly deferred?: Extract<ItemQueryFault, { kind: "unknown" }>;
  readonly dotted?: boolean;
  readonly location: ItemQueryErrorLocation;
  readonly argumentText?: string;
}

/**
 * A custom field that the source does not define fails the query. A bare name
 * outside the built-in names is a custom field of the source or an unknown
 * field.
 */
function unknownCustomField(
  dataset: QueryDataset<any>,
  names: readonly string[],
  { name, bare, location, deferred, dotted, argumentText }: CustomFieldUse,
): Effect.Effect<never, ItemQueryError> {
  const fault: ItemQueryFault =
    deferred && !names.includes(name)
      ? deferred
      : {
          kind: "unknown",
          role: bare && !deferred && !dotted ? "field" : "custom-field",
          name,
          at: location.span ?? { from: 0, to: 0 },
          customFields: names,
          ...(deferred || dotted ? { dotted: true } : {}),
        };
  return Effect.fail(
    new ItemQueryError({
      dataset,
      location,
      ...(argumentText === undefined ? {} : { argumentText }),
      fault,
    }),
  );
}
