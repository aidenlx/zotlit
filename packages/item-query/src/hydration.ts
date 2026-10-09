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
import type { QueryDataset } from "./dataset";
import { ItemQueryError } from "./error";
import type { ItemQueryErrorLocation } from "./error";
import type { ItemQueryFault } from "./fault";
import type { FieldNeeds, QueryItem } from "./fields";
import type { FilterPlan } from "./filter-plan";
import type { PlannedPath } from "./projection";
import type { ItemQueryPlan, PlannedSort, TargetLibrary } from "./request";

/** What one pass loads for each Item of a chunk. */
export interface LoadPlan {
  /** The field values; a built-in name also loads the fields that alias it. */
  readonly fields: HydrateFields;
  /** The relations; each one runs one statement for a chunk. */
  readonly relations: readonly HydrateRelation[];
}

/**
 * One pass of the query over chunks of scan rows: `Plan` is what the pass
 * loads, `Row` a scan row and `Value` what the pass gives for it.
 */
export interface Loader<
  Plan extends object = LoadPlan,
  Row extends ScanRow = ScanRow,
  Value = QueryItem,
> {
  /** What the pass loads. `null`: the pass reads the scan rows only. */
  readonly plan: Plan | null;
  /**
   * The records of one chunk, in chunk order. With a plan, a chunk holds at
   * most `HYDRATE_CHUNK_SIZE` rows and each statement runs in its own step;
   * without one, the pass runs no statement. `libraryAt` identifies the Target
   * Library of each row by its index in the chunk, including mixed Libraries.
   */
  readonly load: (
    chunk: readonly Row[],
    libraryAt: (index: number) => TargetLibrary,
  ) => Effect.Effect<readonly Value[], ItemQueryReaderError, ItemQueryDatabase>;
}

export interface Hydration<
  Plan extends object = LoadPlan,
  Row extends ScanRow = ScanRow,
  Value = QueryItem,
> {
  /** The scan pass: what the filter and the sort read, for every record. */
  readonly scan: Loader<Plan, Row, Value>;
  /** The projection pass: what the Projection Paths read, for each row. */
  readonly projection: Loader<Plan, Row, Value>;
  /** What the candidate plan of one Target Library reads from the source. */
  readonly candidateSources: (library: TargetLibrary) => CandidateSources;
}

/**
 * Open the Hydration of a planned request: read the field vocabulary when a
 * pass loads a field or a relation, check each custom field of the request
 * against the source, and read the Collection paths of each Target Library
 * when a pass loads Collections.
 */
export function openHydration(
  plan: Pick<ItemQueryPlan, "dataset" | "query"> & {
    readonly filter: Pick<FilterPlan, "needs" | "customFields"> | null;
    readonly paths: readonly Pick<
      PlannedPath,
      "text" | "needs" | "customField"
    >[];
    readonly sorts: readonly Pick<PlannedSort, "needs">[];
  },
  libraries: readonly TargetLibrary[],
): Effect.Effect<
  Hydration,
  ItemQueryError | ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const { dataset, filter, paths, sorts } = plan;
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
        return yield* unknownCustomField(
          dataset,
          vocabulary.customFieldNames,
          missing,
        );
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
        libraryAt: (index: number) => TargetLibrary,
      ) =>
        chunk.map(
          (scan, index): QueryItem => ({
            scan,
            groupID: libraryAt(index).groupID,
            hydrated: hydrated.get(scan.itemID) ?? NOTHING_HYDRATED,
            customFieldNames,
          }),
        );
      return {
        plan: passPlan,
        // The Query Items are made in the step of the last hydrate statement.
        load: (chunk, libraryAt) =>
          !vocabulary || !passPlan
            ? Effect.sync(() =>
                itemsOf(chunk, NOTHING_HYDRATED_CHUNK, libraryAt),
              )
            : Effect.map(
                readHydrateChunk({
                  vocabulary,
                  itemIDs: chunk.map((row) => row.itemID),
                  ...passPlan,
                  collectionPaths,
                }),
                (hydrated) => itemsOf(chunk, hydrated, libraryAt),
              ),
      };
    };

    return {
      scan: loader(scanNeeds),
      projection: loader(pathNeeds),
      candidateSources: (library) => ({
        library,
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
