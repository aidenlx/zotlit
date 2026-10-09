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

import type { QueryAttachment } from "./attachment-fields";
import { AttachmentFileResolver } from "./dataset";
import type { ItemQueryError } from "./error";
import type { FieldNeeds } from "./fields";
import { openHydration } from "./hydration";
import type { Hydration, LoadPlan, Loader } from "./hydration";
import type { ItemQueryPlan, TargetLibrary } from "./request";

/** What hydration loads for an Attachment field. */
export interface AttachmentNeeds {
  /** The Attachment values and the Attachment metadata. */
  readonly details?: boolean;
  readonly tags?: boolean;
  /** The Attachment file; resolving it reads the details. */
  readonly file?: boolean;
  /** What the parent Item loads. */
  readonly item?: FieldNeeds;
}

/** What one pass loads for each Attachment of a chunk. */
export interface AttachmentLoadPlan {
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
  plan: ItemQueryPlan<QueryAttachment, AttachmentNeeds>,
  libraries: readonly TargetLibrary[],
): Effect.Effect<
  AttachmentHydration,
  ItemQueryError | ItemQueryReaderError,
  ItemQueryDatabase
> {
  return Effect.gen(function* () {
    const { filter, paths, sorts } = plan;
    const itemNeeds = (needs: AttachmentNeeds): FieldNeeds => needs.item ?? {};
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
      needs: readonly AttachmentNeeds[],
      parent: Loader,
    ): Loader<AttachmentLoadPlan, AttachmentScanRow, QueryAttachment> => {
      const file = needs.some((each) => each.file === true);
      const loads = {
        details: file || needs.some((each) => each.details === true),
        tags: needs.some((each) => each.tags === true),
      };
      const hydrates = loads.details || loads.tags;
      return {
        plan:
          hydrates || parent.plan !== null
            ? { ...loads, file, item: parent.plan }
            : null,
        load: Effect.fnUntraced(function* (chunk, libraryAt) {
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
            )).map((item) => [item.scan.itemID, item]),
          );
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
