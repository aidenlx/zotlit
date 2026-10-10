// Attachment hydration: the values each pass of an Attachment Query loads for
// a chunk of scan rows. The parent Items load through the Item hydration.
import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import { readAttachmentHydrateChunk } from "@zotlit/db/item-query";
import type {
  AttachmentScanRow,
  HydratedAttachment,
  ItemQueryDatabase,
  ItemQueryReaderError,
} from "@zotlit/db/item-query";

import { openAnnotationHydration } from "./annotation-hydration";
import type {
  AnnotationNeeds,
  AnnotationLoadPlan,
} from "./annotation-hydration";
import type { QueryAttachment } from "./attachment-fields";
import { AttachmentFileResolver } from "./dataset";
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
import {
  relationChunk,
  relatedAttachmentAnnotations,
  relationRequest,
  loadRelation,
} from "./relation-hydration";
import type { TargetLibrary } from "./request";

/** What hydration loads for an Attachment field. */
export interface AttachmentNeeds {
  readonly annotations?: readonly AnnotationNeeds[];
  /** The Attachment values and the Attachment metadata. */
  readonly details?: boolean;
  readonly tags?: boolean;
  /** The Attachment file; resolving it reads the details. */
  readonly file?: boolean;
  /** What the parent Item loads. */
  readonly item?: readonly FieldNeeds[];
}

/** What one pass loads for each Attachment of a chunk. */
export interface AttachmentLoadPlan {
  readonly annotations?: AnnotationLoadPlan | null;
  readonly details: boolean;
  readonly tags: boolean;
  readonly file: boolean;
  /** What the pass loads for the parent Items. `null`: their scan rows only. */
  readonly item: LoadPlan | null;
}

export type AttachmentHydration = Hydration<
  AttachmentLoadPlan,
  AttachmentScanRow,
  QueryAttachment
>;

const NOTHING_HYDRATED: HydratedAttachment = {};
const NO_FILE = { path: null, exists: false } as const;

/**
 * Open the Hydration of a planned Attachment Query: the Item hydration of the
 * parent needs, and for each pass the Attachment loads its fields need.
 */
export function openAttachmentHydration(
  plan: HydrationRequest<AttachmentNeeds>,
  libraries: readonly TargetLibrary[],
  source?: HydrationVocabulary,
): Effect.Effect<
  AttachmentHydration,
  ItemQueryError | ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const { filter, paths, sorts } = plan;
    const readVocabulary = source ?? (yield* openHydrationVocabulary);
    const itemNeeds = (needs: AttachmentNeeds): readonly FieldNeeds[] =>
      needs.item ?? [];
    const parents = yield* openHydration(
      {
        dataset: plan.dataset,
        query: plan.query,
        group: plan.group,
        groupNeeds: plan.groupNeeds.flatMap(itemNeeds),
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
    const resolveAttachmentFile = yield* AttachmentFileResolver;
    const groupOf = new Map(
      libraries.map((library) => [library.libraryID, library.groupID]),
    );

    const relatedSources: Hydration["candidateSources"][] = [
      parents.candidateSources,
    ];
    const loader = Effect.fnUntraced(function* (
      needs: readonly AttachmentNeeds[],
      parent: Loader,
    ) {
      const annotations = needs.some((need) => need.annotations !== undefined)
        ? yield* openAnnotationHydration(
            relationRequest(
              plan,
              needs.flatMap((need) => need.annotations ?? []),
            ),
            libraries,
            readVocabulary,
          )
        : null;
      if (annotations) relatedSources.push(annotations.candidateSources);
      const file = needs.some((each) => each.file === true);
      const loads = {
        details: file || needs.some((each) => each.details === true),
        tags: needs.some((each) => each.tags === true),
      };
      const hydrates = loads.details || loads.tags;
      const loader: Loader<
        AttachmentLoadPlan,
        AttachmentScanRow,
        QueryAttachment
      > = {
        plan:
          hydrates || parent.plan !== null || annotations
            ? {
                ...loads,
                file,
                item: parent.plan,
                ...(annotations && { annotations: annotations.scan.plan }),
              }
            : null,
        load: Effect.fnUntraced(function* (
          chunk,
          libraryAt,
          relations = relationChunk(),
        ) {
          const hydrated = hydrates
            ? yield* readAttachmentHydrateChunk({ rows: chunk, ...loads })
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
          const marks = annotations
            ? yield* loadRelation(
                annotations.scan,
                yield* relatedAttachmentAnnotations(
                  relations,
                  chunk.map((row) => row.itemID),
                ),
                { libraries, relations, parentID: (row) => row.attachmentID },
              )
            : null;
          const result: QueryAttachment[] = [];
          for (const scan of chunk) {
            const attachment = hydrated?.get(scan.itemID) ?? NOTHING_HYDRATED;
            const groupID = groupOf.get(scan.libraryID) ?? null;
            const details = attachment.details;
            result.push({
              scan,
              attachment,
              groupID,
              file:
                file &&
                resolveAttachmentFile &&
                details &&
                details.linkMode !== 3
                  ? yield* resolveAttachmentFile({
                      ...details,
                      groupID,
                      indexedKey: formatIndexedKey(scan.key, groupID),
                    })
                  : NO_FILE,
              parent: parentItems.get(scan.parent.itemID)!,
              ...(marks && { annotations: marks.get(scan.itemID) ?? [] }),
            });
          }
          return result;
        }),
      };
      return loader;
    });

    return {
      scan: yield* loader(
        [
          ...(filter?.needs ?? []),
          ...sorts.map((sort) => sort.needs),
          ...plan.groupNeeds,
        ],
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
