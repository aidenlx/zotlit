// The Attachment loading descriptor: its fields, parent Item, and Annotations.
import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import { readAttachmentHydrateChunk } from "@zotlit/db/item-query";
import type {
  AttachmentScanRow,
  HydratedAttachment,
} from "@zotlit/db/item-query";

import type { QueryAnnotation } from "./annotation-fields";
import { ANNOTATION_LOADING } from "./annotation-hydration";
import type { AnnotationNeeds } from "./annotation-hydration";
import type { QueryAttachment } from "./attachment-fields";
import { AttachmentFileResolver } from "./dataset";
import type { FieldNeeds, QueryItem } from "./fields";
import { ITEM_LOADING } from "./hydration";
import { parentRecord, relationList } from "./record-loader";
import type { LoadingDescriptor } from "./record-loader";
import { relatedAttachmentAnnotations } from "./relation-hydration";

/** What Hydration loads for an Attachment field. */
export interface AttachmentNeeds {
  readonly annotations?: readonly AnnotationNeeds[];
  readonly details?: boolean;
  readonly tags?: boolean;
  readonly file?: boolean;
  readonly item?: readonly FieldNeeds[];
}

interface AttachmentOwn {
  readonly attachment: HydratedAttachment;
  readonly file: QueryAttachment["file"];
}
interface AttachmentLinks {
  readonly parent: QueryItem;
  readonly annotations: readonly QueryAnnotation[];
}

export const ATTACHMENT_LOADING: LoadingDescriptor<
  AttachmentNeeds,
  AttachmentScanRow,
  AttachmentOwn,
  AttachmentLinks,
  QueryAttachment
> = {
  own: Effect.fnUntraced(function* (needs) {
    const resolveFile = yield* AttachmentFileResolver;
    const file = needs.some((need) => need.file);
    const details = file || needs.some((need) => need.details);
    const tags = needs.some((need) => need.tags);
    return {
      hydrates: details || tags,
      load: Effect.fnUntraced(function* (chunk, libraryAt) {
        const loaded =
          details || tags
            ? yield* readAttachmentHydrateChunk({ rows: chunk, details, tags })
            : null;
        const values: AttachmentOwn[] = [];
        for (const [index, scan] of chunk.entries()) {
          const attachment = loaded?.get(scan.itemID) ?? NOTHING_HYDRATED;
          const groupID = libraryAt(index).groupID;
          values.push({
            attachment,
            file:
              file &&
              resolveFile &&
              attachment.details &&
              attachment.details.linkMode !== 3
                ? yield* resolveFile({
                    ...attachment.details,
                    groupID,
                    indexedKey: formatIndexedKey(scan.key, groupID),
                  })
                : NO_FILE,
          });
        }
        return values;
      }),
    };
  }),
  relations: {
    parent: parentRecord({
      needs: (need: AttachmentNeeds) => need.item,
      descriptor: () => ITEM_LOADING,
      row: (row: AttachmentScanRow) => row.parent,
      required: true,
    }),
    annotations: relationList({
      needs: (need: AttachmentNeeds) => need.annotations,
      descriptor: () => ANNOTATION_LOADING,
      read: relatedAttachmentAnnotations,
      parentID: (row) => row.attachmentID,
    }),
  },
  record: (own, { scan, library, related }) => ({
    scan,
    ...own,
    groupID: library.groupID,
    ...related,
    parent: related.parent!,
  }),
};

const NOTHING_HYDRATED: HydratedAttachment = {};
const NO_FILE = { path: null, exists: false } as const;
