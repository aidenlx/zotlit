// Hydration: what a query reads from the source once, and the values each pass
// loads for a chunk of scan rows. The engine gets Query Items from here and
// holds no reader state of its own.
import { Effect } from "effect";

import { readHydrateChunk } from "@zotlit/db/item-query";
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

import type { QueryAnnotation } from "./annotation-fields";
import { openAnnotationHydration } from "./annotation-hydration";
import type { AnnotationLoadPlan } from "./annotation-hydration";
import type { QueryAttachment } from "./attachment-fields";
import { openAttachmentHydration } from "./attachment-hydration";
import type { AttachmentLoadPlan } from "./attachment-hydration";
import type { ItemQueryError } from "./error";
import type { FieldNeeds, QueryItem } from "./fields";
import type { FilterPlan } from "./filter-plan";
import type { QuerySources } from "./query-sources";
import type { RelationChunk } from "./relation-hydration";
import {
  relationChunk,
  relatedAttachments,
  relatedItemAnnotations,
  relationRequest,
  loadRelation,
} from "./relation-hydration";
import type { ItemQueryPlan, TargetLibrary } from "./request";

/** What one pass loads for each Item of a chunk. */
export interface LoadPlan {
  /** The field values; a built-in name also loads the fields that alias it. */
  readonly fields: HydrateFields;
  /** The relations; each one runs one statement for a chunk. */
  readonly relations: readonly HydrateRelation[];
  readonly attachments?: AttachmentLoadPlan | null;
  readonly annotations?: AnnotationLoadPlan | null;
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
    relations?: RelationChunk,
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
}

/**
 * Open the Hydration of a planned request: read the field vocabulary when a
 * pass loads a field or a relation, check each custom field of the request
 * against the source, and read the Collection paths of each Target Library
 * when a pass loads Collections.
 */
export type HydrationRequest<Needs> = Pick<
  ItemQueryPlan,
  "dataset" | "query"
> & {
  readonly group?: {
    readonly text: string;
    readonly customField: string | null;
  } | null;
  readonly groupNeeds: readonly Needs[];
  readonly filter: {
    readonly needs: readonly Needs[];
    readonly customFields: FilterPlan["customFields"];
  } | null;
  readonly paths: readonly {
    readonly text: string;
    readonly needs: Needs;
    readonly customField: string | null;
  }[];
  readonly sorts: readonly { readonly needs: Needs }[];
};

export function openHydration(
  plan: HydrationRequest<FieldNeeds>,
  libraries: readonly TargetLibrary[],
  sources: QuerySources,
): Effect.Effect<
  Hydration,
  ItemQueryError | ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const { filter, paths, sorts, group } = plan;
    const readVocabulary = sources.vocabulary();
    const pathNeeds = paths.map((path) => path.needs);
    const scanNeeds = [
      ...(filter?.needs ?? []),
      ...sorts.map((sort) => sort.needs),
      ...plan.groupNeeds,
    ];
    const allNeeds = [...pathNeeds, ...scanNeeds];
    const vocabulary =
      allNeeds.some(needsHydration) ||
      filter?.customFields.length ||
      paths.some((path) => path.customField !== null) ||
      (group && group.customField !== null)
        ? yield* readVocabulary
        : null;
    yield* sources.checkCustomFields(plan);
    // A Collection path belongs to one Library: a leaf of the filter reads
    // the paths of the Library it runs in. A Collection ID names one
    // Collection of the copy, so hydration reads the paths of them all.
    const pathsOf = new Map<TargetLibrary, CollectionPaths>();
    if (allNeeds.some((needs) => needs.relations?.includes("collections"))) {
      for (const library of libraries) {
        pathsOf.set(library, yield* sources.collectionPaths(library));
      }
    }
    const collectionPaths: CollectionPaths | undefined =
      pathsOf.size > 0
        ? new Map([...pathsOf.values()].flatMap((paths) => [...paths]))
        : undefined;
    const customFieldNames = vocabulary?.customFieldNames ?? [];

    const loader = Effect.fnUntraced(function* (needs: readonly FieldNeeds[]) {
      const annotations = needs.some((need) => need.annotations !== undefined)
        ? yield* openAnnotationHydration(
            relationRequest(
              plan,
              needs.flatMap((need) => need.annotations ?? []),
            ),
            libraries,
            sources,
          )
        : null;
      const attachments = needs.some((need) => need.attachments !== undefined)
        ? yield* openAttachmentHydration(
            relationRequest(
              plan,
              needs.flatMap((need) => need.attachments ?? []),
            ),
            libraries,
            sources,
          )
        : null;
      const passPlan =
        vocabulary && needs.some(needsHydration)
          ? loadPlan(needs, vocabulary)
          : null;
      const itemsOf = (
        chunk: readonly ScanRow[],
        hydrated: ReadonlyMap<number, HydratedItem>,
        {
          libraryAt,
          related,
          marks,
        }: {
          readonly libraryAt: (index: number) => TargetLibrary;
          readonly related?: ReadonlyMap<number, readonly QueryAttachment[]>;
          readonly marks?: ReadonlyMap<number, readonly QueryAnnotation[]>;
        },
      ) =>
        chunk.map(
          (scan, index): QueryItem => ({
            scan,
            groupID: libraryAt(index).groupID,
            hydrated: hydrated.get(scan.itemID) ?? NOTHING_HYDRATED,
            customFieldNames,
            ...(attachments && {
              attachments: related?.get(scan.itemID) ?? [],
            }),
            ...(annotations && { annotations: marks?.get(scan.itemID) ?? [] }),
          }),
        );
      const result: Loader = {
        plan:
          attachments || annotations
            ? {
                fields: { builtIn: [], custom: [] },
                relations: [],
                ...passPlan,
                ...(attachments && { attachments: attachments.scan.plan }),
                ...(annotations && { annotations: annotations.scan.plan }),
              }
            : passPlan,
        load: Effect.fnUntraced(function* (
          chunk,
          libraryAt,
          relations = relationChunk(),
        ) {
          const hydrated =
            vocabulary && passPlan
              ? yield* readHydrateChunk({
                  vocabulary,
                  itemIDs: chunk.map((row) => row.itemID),
                  ...passPlan,
                  collectionPaths,
                })
              : NOTHING_HYDRATED_CHUNK;
          const related = attachments
            ? yield* loadRelation(
                attachments.scan,
                yield* relatedAttachments(
                  relations,
                  chunk.map((row) => row.itemID),
                ),
                { libraries, relations, parentID: (row) => row.parent.itemID },
              )
            : undefined;
          const marks = annotations
            ? yield* loadRelation(
                annotations.scan,
                yield* relatedItemAnnotations(
                  relations,
                  chunk.map((row) => row.itemID),
                ),
                { libraries, relations, parentID: (row) => row.parent.itemID },
              )
            : undefined;
          return itemsOf(chunk, hydrated, { libraryAt, related, marks });
        }),
      };
      return result;
    });

    return {
      scan: yield* loader(scanNeeds),
      projection: yield* loader(pathNeeds),
    };
  });
}

const NOTHING_HYDRATED: HydratedItem = { fields: new Map(), custom: new Map() };
const NOTHING_HYDRATED_CHUNK: ReadonlyMap<number, HydratedItem> = new Map();

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
