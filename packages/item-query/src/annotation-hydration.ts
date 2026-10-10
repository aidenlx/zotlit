// Annotation hydration: the values each pass of an Annotation Query loads for
// a chunk of scan rows. The parent Items load through the Item hydration.
import { Effect } from "effect";

import { readAnnotationHydrateChunk } from "@zotlit/db/item-query";
import type {
  AnnotationScanRow,
  AttachmentScanRow,
  HydratedAnnotation,
  ItemQueryDatabase,
  ItemQueryReaderError,
} from "@zotlit/db/item-query";

import type { QueryAnnotation } from "./annotation-fields";
import { openAttachmentHydration } from "./attachment-hydration";
import type {
  AttachmentNeeds,
  AttachmentLoadPlan,
} from "./attachment-hydration";
import type { ItemQueryError } from "./error";
import type { FieldNeeds } from "./fields";
import { openHydration, openHydrationVocabulary } from "./hydration";
import type {
  Hydration,
  HydrationRequest,
  HydrationVocabulary,
  LoadPlan,
  Loader,
} from "./hydration";
import { relationChunk, relationRequest } from "./relation-hydration";
import type { TargetLibrary } from "./request";

/** What hydration loads for an Annotation field. */
export interface AnnotationNeeds {
  /** The Annotation values and the Attachment metadata. */
  readonly details?: boolean;
  readonly tags?: boolean;
  readonly attachment?: readonly AttachmentNeeds[];
  /** What the parent Item loads. */
  readonly item?: readonly FieldNeeds[];
}

/** What one pass loads for each Annotation of a chunk. */
export interface AnnotationLoadPlan {
  readonly details: boolean;
  readonly tags: boolean;
  readonly attachment?: AttachmentLoadPlan | null;
  /** What the pass loads for the parent Items. `null`: their scan rows only. */
  readonly item: LoadPlan | null;
}

export type AnnotationHydration = Hydration<
  AnnotationLoadPlan,
  AnnotationScanRow,
  QueryAnnotation
>;

const NOTHING_HYDRATED: HydratedAnnotation = {};

/**
 * Open the Hydration of a planned Annotation Query: the Item hydration of the
 * parent needs, and for each pass the Annotation loads its fields need.
 */
export function openAnnotationHydration(
  plan: HydrationRequest<AnnotationNeeds>,
  libraries: readonly TargetLibrary[],
  source?: HydrationVocabulary,
): Effect.Effect<
  AnnotationHydration,
  ItemQueryError | ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const { filter, paths, sorts } = plan;
    const readVocabulary = source ?? (yield* openHydrationVocabulary);
    const itemNeeds = (needs: AnnotationNeeds): readonly FieldNeeds[] =>
      needs.item ?? [];
    const parents = yield* openHydration(
      {
        dataset: plan.dataset,
        query: plan.query,
        group: plan.group,
        filter: filter && {
          customFields: filter.customFields,
          needs: filter.needs.flatMap(itemNeeds),
        },
        paths: paths.flatMap(({ text, customField, needs }) =>
          (itemNeeds(needs).length ? itemNeeds(needs) : [{}]).map((need) => ({
            text,
            customField,
            needs: need,
          })),
        ),
        sorts: sorts.flatMap(({ needs }) =>
          itemNeeds(needs).map((need) => ({ needs: need })),
        ),
      },
      libraries,
      readVocabulary,
    );
    const groupOf = new Map(
      libraries.map((library) => [library.libraryID, library.groupID]),
    );

    const relatedSources: Hydration["candidateSources"][] = [
      parents.candidateSources,
    ];
    const loader = Effect.fnUntraced(function* (
      needs: readonly AnnotationNeeds[],
      parent: Loader,
    ) {
      const attachment = needs.some((need) => need.attachment !== undefined)
        ? yield* openAttachmentHydration(
            relationRequest(
              plan,
              needs.flatMap((need) => need.attachment ?? []),
            ),
            libraries,
            readVocabulary,
          )
        : null;
      if (attachment) relatedSources.push(attachment.candidateSources);
      const loads = {
        details: needs.some((each) => each.details === true),
        tags: needs.some((each) => each.tags === true),
      };
      const hydrates = loads.details || loads.tags;
      const loader: Loader<
        AnnotationLoadPlan,
        AnnotationScanRow,
        QueryAnnotation
      > = {
        plan:
          hydrates || parent.plan !== null || attachment
            ? {
                ...loads,
                item: parent.plan,
                ...(attachment && { attachment: attachment.scan.plan }),
              }
            : null,
        load: Effect.fnUntraced(function* (
          chunk,
          libraryAt,
          relations = relationChunk(),
        ) {
          const hydrated = hydrates
            ? yield* readAnnotationHydrateChunk({ rows: chunk, ...loads })
            : null;
          const parents = [
            ...new Map(
              chunk.map((row, index) => [
                row.parent.itemID,
                { scan: row.parent, library: libraryAt(index) },
              ]),
            ).values(),
          ];
          const parentItems = new Map(
            (yield* parent.load(
              parents.map((row) => row.scan),
              (index) => parents[index]!.library,
              relations,
            )).map((item) => [item.scan.itemID, item]),
          );
          const attachmentRows: AttachmentScanRow[] = [
            ...new Map(
              chunk.map((row) => [
                row.attachmentID,
                {
                  itemID: row.attachmentID,
                  key: row.attachmentKey,
                  itemType: "attachment",
                  dateAdded: row.attachmentDateAdded,
                  dateModified: row.attachmentDateModified,
                  libraryID: row.libraryID,
                  parent: row.parent,
                },
              ]),
            ).values(),
          ];
          const byLibrary = new Map(
            libraries.map((library) => [library.libraryID, library]),
          );
          const attachmentRecords = attachment
            ? new Map(
                (yield* attachment.scan.load(
                  attachmentRows,
                  (index) => byLibrary.get(attachmentRows[index]!.libraryID)!,
                  relations,
                )).map((row) => [row.scan.itemID, row]),
              )
            : null;
          const result: QueryAnnotation[] = [];
          for (const scan of chunk) {
            const annotation = hydrated?.get(scan.itemID) ?? NOTHING_HYDRATED;
            const groupID = groupOf.get(scan.libraryID) ?? null;
            result.push({
              scan,
              annotation,
              groupID,
              ...(attachmentRecords && {
                attachmentRecord: attachmentRecords.get(scan.attachmentID)!,
              }),
              parent: parentItems.get(scan.parent.itemID)!,
            });
          }
          return result;
        }),
      };
      return loader;
    });

    return {
      scan: yield* loader(
        [...(filter?.needs ?? []), ...sorts.map((sort) => sort.needs)],
        parents.scan,
      ),
      projection: yield* loader(
        paths.map((path) => path.needs),
        parents.projection,
      ),
      candidateSources: (library) => {
        const sources = relatedSources.map((source) => source(library));
        return {
          library,
          vocabulary:
            sources.find((source) => source.vocabulary)?.vocabulary ?? null,
          collectionPaths: sources.find((source) => source.collectionPaths)
            ?.collectionPaths,
        };
      },
    };
  });
}
