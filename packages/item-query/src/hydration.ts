// The Item loading descriptor: stored fields and its child Relation Lists.
import { Effect } from "effect";

import { readHydrateChunk } from "@zotlit/db/item-query";
import type {
  CollectionPaths,
  HydratedItem,
  HydrateRelation,
  ScanRow,
} from "@zotlit/db/item-query";

import type { QueryAnnotation } from "./annotation-fields";
import { ANNOTATION_LOADING } from "./annotation-hydration";
import type { QueryAttachment } from "./attachment-fields";
import { ATTACHMENT_LOADING } from "./attachment-hydration";
import type { FieldNeeds, QueryItem } from "./fields";
import { relationList } from "./record-loader";
import type { LoadingDescriptor } from "./record-loader";
import {
  relatedAttachments,
  relatedItemAnnotations,
} from "./relation-hydration";

interface ItemOwn {
  readonly hydrated: HydratedItem;
  readonly customFieldNames: readonly string[];
}
interface ItemLinks {
  readonly attachments: readonly QueryAttachment[];
  readonly annotations: readonly QueryAnnotation[];
}

export const ITEM_LOADING: LoadingDescriptor<
  FieldNeeds,
  ScanRow,
  ItemOwn,
  ItemLinks,
  QueryItem
> = {
  own: Effect.fnUntraced(function* (needs, { sources, libraries }) {
    const hydrates = needs.some(
      (need) =>
        need.builtIn?.length || need.custom?.length || need.relations?.length,
    );
    const vocabulary = hydrates ? yield* sources.vocabulary() : null;
    const fields = {
      builtIn: [...new Set(needs.flatMap((need) => need.builtIn ?? []))],
      custom: [
        ...new Set(
          needs.flatMap((need) =>
            need.custom === "all"
              ? vocabulary!.customFieldNames
              : (need.custom ?? []),
          ),
        ),
      ],
    };
    const relations: HydrateRelation[] = [
      ...new Set(needs.flatMap((need) => need.relations ?? [])),
    ];
    let collectionPaths: CollectionPaths | undefined;
    if (relations.includes("collections")) {
      const paths = new Map<number, readonly string[]>();
      for (const library of libraries) {
        for (const [id, path] of yield* sources.collectionPaths(library))
          paths.set(id, path);
      }
      collectionPaths = paths;
    }
    return {
      hydrates,
      load: Effect.fnUntraced(function* (chunk) {
        const loaded = vocabulary
          ? yield* readHydrateChunk({
              vocabulary,
              itemIDs: chunk.map((row) => row.itemID),
              fields,
              relations,
              collectionPaths,
            })
          : null;
        return chunk.map((row) => ({
          hydrated: loaded?.get(row.itemID) ?? NOTHING_HYDRATED,
          customFieldNames: vocabulary?.customFieldNames ?? [],
        }));
      }),
    };
  }),
  relations: {
    attachments: relationList({
      needs: (need: FieldNeeds) => need.attachments,
      descriptor: () => ATTACHMENT_LOADING,
      read: relatedAttachments,
      parentID: (row) => row.parent.itemID,
    }),
    annotations: relationList({
      needs: (need: FieldNeeds) => need.annotations,
      descriptor: () => ANNOTATION_LOADING,
      read: relatedItemAnnotations,
      parentID: (row) => row.parent.itemID,
    }),
  },
  record: (own, { scan, library, related }) => ({
    scan,
    ...own,
    groupID: library.groupID,
    ...related,
  }),
};

const NOTHING_HYDRATED: HydratedItem = { fields: new Map(), custom: new Map() };
