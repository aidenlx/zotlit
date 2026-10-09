// Annotation hydration: the values each pass of an Annotation Query loads for
// a chunk of scan rows. The parent Items load through the Item hydration.
import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import { readAnnotationHydrateChunk } from "@zotlit/db/item-query";
import type {
  AnnotationScanRow,
  HydratedAnnotation,
  ItemQueryDatabase,
  ItemQueryReaderError,
} from "@zotlit/db/item-query";

import type { QueryAnnotation } from "./annotation-fields";
import { AttachmentFileResolver } from "./dataset";
import type { ItemQueryError } from "./error";
import type { FieldNeeds } from "./fields";
import { openHydration } from "./hydration";
import type { Hydration, LoadPlan, Loader } from "./hydration";
import type { ItemQueryPlan, TargetLibrary } from "./request";

/** What hydration loads for an Annotation field. */
export interface AnnotationNeeds {
  /** The Annotation values and the Attachment metadata. */
  readonly details?: boolean;
  readonly tags?: boolean;
  readonly attachmentTitle?: boolean;
  /** The Attachment file; resolving it reads the details. */
  readonly file?: boolean;
  /** What the parent Item loads. */
  readonly item?: FieldNeeds;
}

/** What one pass loads for each Annotation of a chunk. */
export interface AnnotationLoadPlan {
  readonly details: boolean;
  readonly tags: boolean;
  readonly attachmentTitle: boolean;
  readonly file: boolean;
  /** What the pass loads for the parent Items. `null`: their scan rows only. */
  readonly item: LoadPlan | null;
}

export type AnnotationHydration = Hydration<
  AnnotationLoadPlan,
  AnnotationScanRow,
  QueryAnnotation
>;

const NOTHING_HYDRATED: HydratedAnnotation = {};
const NO_FILE = { path: null, exists: false } as const;

/**
 * Open the Hydration of a planned Annotation Query: the Item hydration of the
 * parent needs, and for each pass the Annotation loads its fields need.
 */
export function openAnnotationHydration(
  plan: ItemQueryPlan<QueryAnnotation, AnnotationNeeds>,
  libraries: readonly TargetLibrary[],
): Effect.Effect<
  AnnotationHydration,
  ItemQueryError | ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const { filter, paths, sorts } = plan;
    const itemNeeds = (needs: AnnotationNeeds): FieldNeeds => needs.item ?? {};
    const parents = yield* openHydration(
      {
        dataset: plan.dataset,
        query: plan.query,
        filter: filter && {
          customFields: filter.customFields,
          needs: filter.needs.map(itemNeeds),
        },
        paths: paths.map(({ text, customField, needs }) => ({
          text,
          customField,
          needs: itemNeeds(needs),
        })),
        sorts: sorts.map(({ needs }) => ({ needs: itemNeeds(needs) })),
      },
      libraries,
    );
    const resolveAttachmentFile = yield* AttachmentFileResolver;
    const groupOf = new Map(
      libraries.map((library) => [library.libraryID, library.groupID]),
    );

    const loader = (
      needs: readonly AnnotationNeeds[],
      parent: Loader,
    ): Loader<AnnotationLoadPlan, AnnotationScanRow, QueryAnnotation> => {
      const file = needs.some((each) => each.file === true);
      const loads = {
        details: file || needs.some((each) => each.details === true),
        tags: needs.some((each) => each.tags === true),
        attachmentTitle: needs.some((each) => each.attachmentTitle === true),
      };
      const hydrates = loads.details || loads.tags || loads.attachmentTitle;
      return {
        plan:
          hydrates || parent.plan !== null
            ? { ...loads, file, item: parent.plan }
            : null,
        load: Effect.fnUntraced(function* (chunk) {
          const hydrated = hydrates
            ? yield* readAnnotationHydrateChunk({ rows: chunk, ...loads })
            : null;
          const parentItems = new Map(
            (yield* parent.load([
              ...new Map(
                chunk.map((row) => [row.parent.itemID, row.parent]),
              ).values(),
            ])).map((item) => [item.scan.itemID, item]),
          );
          const result: QueryAnnotation[] = [];
          for (const scan of chunk) {
            const annotation = hydrated?.get(scan.itemID) ?? NOTHING_HYDRATED;
            const groupID = groupOf.get(scan.libraryID) ?? null;
            const attachment = annotation.details?.attachment;
            result.push({
              scan,
              annotation,
              groupID,
              file:
                file && resolveAttachmentFile && attachment
                  ? yield* resolveAttachmentFile({
                      ...attachment,
                      groupID,
                      indexedKey: formatIndexedKey(scan.attachmentKey, groupID),
                    })
                  : NO_FILE,
              parent: parentItems.get(scan.parent.itemID)!,
            });
          }
          return result;
        }),
      };
    };

    return {
      scan: loader(
        [...(filter?.needs ?? []), ...sorts.map((sort) => sort.needs)],
        parents.scan,
      ),
      projection: loader(
        paths.map((path) => path.needs),
        parents.projection,
      ),
      candidateSources: parents.candidateSources,
    };
  });
}
