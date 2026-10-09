// Hydration: what a query reads from the source once, and the values each pass
// loads for a chunk of scan rows. The engine gets Query Items from here and
// holds no reader state of its own.
import { Effect } from "effect";

import {
  readCollectionPaths,
  readFieldVocabulary,
  readHydrateChunk,
} from "@zotlit/db/item-query";
import type {
  CollectionPaths,
  FieldVocabulary,
  HydratedItem,
  HydrateFields,
  HydrateRelation,
  ItemQueryDatabase,
  ItemQueryReaderError,
  ScanRow,
} from "@zotlit/db/item-query";

import type { CandidateSources } from "./candidate-plan";
import { ItemQueryError } from "./error";
import type { ItemQueryErrorLocation } from "./error";
import type { ItemQueryFault } from "./fault";
import type { FieldNeeds, QueryItem } from "./fields";
import type { FilterPlan } from "./filter-plan";
import type { PlannedPath } from "./projection";
import type { PlannedSort, TargetLibrary } from "./request";

/** What one pass loads for each Item of a chunk. */
export interface LoadPlan {
  /** The field values; a built-in name also loads the fields that alias it. */
  readonly fields: HydrateFields;
  /** The relations; each one runs one statement for a chunk. */
  readonly relations: readonly HydrateRelation[];
}

/** One pass of the query over chunks of scan rows. */
export interface Loader {
  /** What the pass loads. `null`: the pass reads the scan rows only. */
  readonly plan: LoadPlan | null;
  /**
   * The Query Items of one chunk, in chunk order. With a plan, a chunk holds
   * at most `HYDRATE_CHUNK_SIZE` rows and each statement runs in its own step;
   * without one, the pass runs no statement.
   */
  readonly load: (
    chunk: readonly ScanRow[],
  ) => Effect.Effect<
    readonly QueryItem[],
    ItemQueryReaderError,
    ItemQueryDatabase
  >;
}

export interface Hydration {
  /** The scan pass: what the filter and the sort read, for every Item. */
  readonly scan: Loader;
  /** The projection pass: what the Projection Paths read, for each row. */
  readonly projection: Loader;
  /** What the candidate plan of one Target Library reads from the source. */
  readonly candidateSources: (library: TargetLibrary) => CandidateSources;
}

/**
 * Open the Hydration of a planned request: read the field vocabulary when a
 * pass loads a field or a relation, check each custom field of the request
 * against the source, and read the Collection paths of each Target Library
 * when a pass loads Collections.
 */
export function openHydration<Item>(
  plan: {
    filter: FilterPlan<Item> | null;
    paths: readonly PlannedPath<Item>[];
    sorts: readonly Pick<PlannedSort, "needs">[];
  },
  libraries: readonly TargetLibrary[],
): Effect.Effect<
  Hydration,
  ItemQueryError | ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const { filter, paths, sorts } = plan;
    const pathNeeds = paths.map((path) => path.needs);
    const scanNeeds = [
      ...(filter?.needs ?? []),
      ...sorts.map((sort) => sort.needs),
    ];
    const allNeeds = [...pathNeeds, ...scanNeeds];
    const vocabulary = allNeeds.some(needsHydration)
      ? yield* readFieldVocabulary()
      : null;
    if (vocabulary) {
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
                }
              : {
                  name,
                  bare,
                  deferred,
                  location: { argument: "filter", span: { from, to } },
                },
        ),
        ...paths.flatMap(({ customField: name }, index): CustomFieldUse[] =>
          name === null
            ? []
            : [
                {
                  name,
                  bare: false,
                  location: {
                    argument: "fields",
                    index,
                    path: `fields[${index}]`,
                  },
                  argumentText: JSON.stringify(paths.map((path) => path.text)),
                },
              ],
        ),
      ];
      const missing = customFields.find(
        ({ name, deferred, dotted }) => dotted || deferred || !known.has(name),
      );
      if (missing) {
        return yield* unknownCustomField(vocabulary.customFieldNames, missing);
      }
    }
    // A Collection path belongs to one Library: a leaf of the filter reads
    // the paths of the Library it runs in. A Collection ID names one
    // Collection of the copy, so hydration reads the paths of them all.
    const pathsOf = new Map<TargetLibrary, CollectionPaths>();
    if (allNeeds.some((needs) => needs.relations?.includes("collections"))) {
      for (const library of libraries) {
        pathsOf.set(library, yield* readCollectionPaths(library));
      }
    }
    const collectionPaths: CollectionPaths | undefined =
      pathsOf.size > 0
        ? new Map([...pathsOf.values()].flatMap((paths) => [...paths]))
        : undefined;
    const customFieldNames = vocabulary?.customFieldNames ?? [];

    const loader = (needs: readonly FieldNeeds[]): Loader => {
      const passPlan =
        vocabulary && needs.some(needsHydration)
          ? loadPlan(needs, vocabulary)
          : null;
      const itemsOf = (
        chunk: readonly ScanRow[],
        hydrated: ReadonlyMap<number, HydratedItem>,
      ) =>
        chunk.map(
          (scan): QueryItem => ({
            scan,
            hydrated: hydrated.get(scan.itemID) ?? NOTHING_HYDRATED,
            customFieldNames,
          }),
        );
      return {
        plan: passPlan,
        // The Query Items are made in the step of the last hydrate statement.
        load: (chunk) =>
          !vocabulary || !passPlan
            ? Effect.sync(() => itemsOf(chunk, NOTHING_HYDRATED_CHUNK))
            : Effect.map(
                readHydrateChunk({
                  vocabulary,
                  itemIDs: chunk.map((row) => row.itemID),
                  ...passPlan,
                  collectionPaths,
                }),
                (hydrated) => itemsOf(chunk, hydrated),
              ),
      };
    };

    return {
      scan: loader(scanNeeds),
      projection: loader(pathNeeds),
      candidateSources: (library) => ({
        vocabulary,
        collectionPaths: pathsOf.get(library),
      }),
    };
  });
}

const NOTHING_HYDRATED: HydratedItem = { fields: new Map(), custom: new Map() };
const NOTHING_HYDRATED_CHUNK: ReadonlyMap<number, HydratedItem> = new Map();

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
      location,
      ...(argumentText === undefined ? {} : { argumentText }),
      fault,
    }),
  );
}

function needsHydration(needs: FieldNeeds): boolean {
  return Boolean(
    needs.builtIn?.length || needs.custom?.length || needs.relations?.length,
  );
}

function loadPlan(
  allNeeds: readonly FieldNeeds[],
  vocabulary: FieldVocabulary,
): LoadPlan {
  const builtIn = new Set<string>();
  const custom = new Set<string>();
  const relations = new Set<HydrateRelation>();
  for (const needs of allNeeds) {
    for (const name of needs.builtIn ?? []) builtIn.add(name);
    const names =
      needs.custom === "all" ? vocabulary.customFieldNames : needs.custom;
    for (const name of names ?? []) custom.add(name);
    for (const relation of needs.relations ?? []) relations.add(relation);
  }
  return {
    fields: { builtIn: [...builtIn], custom: [...custom] },
    relations: [...relations],
  };
}
