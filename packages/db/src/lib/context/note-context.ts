// Fetches the DB rows a note/annotation template needs and assembles them via the pure zt-* mappers.
import { distinct } from "@std/collections";

import type { NodeDatabaseClient } from "@/client/node";
import { annotationToTemplateData } from "@/lib/context/zt-template-annot";
import type { TemplateAnnotation } from "@/lib/context/zt-template-annot";
import { resolveTemplateAttachment } from "@/lib/context/zt-template-attach";
import type { TemplateAttachment } from "@/lib/context/zt-template-attach";
import {
  itemToTemplateBaseData,
  resolveItemCore,
  withItemPreview,
} from "@/lib/context/zt-template-item";
import type {
  TemplateItemResolvers,
  TemplateParentItemData,
} from "@/lib/context/zt-template-item";
import type { Annotation } from "@/lib/zt-annot";
import type { Attachment } from "@/lib/zt-attach";
import type { CollectionCache } from "@/lib/zt-collection";
import type { GroupIDMemo } from "@/queries/_groups";
import { getCurrentUsername } from "@/queries/account";
import { getAnnotationsByParent } from "@/queries/annotations";
import {
  getAttachmentByItemId,
  getAttachmentsByParents,
} from "@/queries/attachments";
import { getRelatedKeysByItemID } from "@/queries/item-relations";
import { getItemsByID, getItemsByKey } from "@/queries/items";
import type { Item } from "@/queries/items";
import { getChildNotes } from "@/queries/notes";
import type { ChildNote } from "@/queries/notes";
import { resolveItemTagsByIDs } from "@/queries/tags";
import type { TagMemo } from "@/queries/tags";

import { buildNoteContext } from "./zt-template-note";
import type {
  AnnotationResolvers,
  NoteTemplateContext,
  TemplateNoteLink,
} from "./zt-template-note";

export type { AnnotationResolvers };

export interface NoteResolvers {
  annotation: AnnotationResolvers;
  item: TemplateItemResolvers;
  /** Map a child note to its link-only template shape. */
  resolveChildNote?: (note: ChildNote) => TemplateNoteLink;
}

/**
 * Build the full {@link NoteTemplateContext} for `item`: fetches its
 * attachments, annotations, related items, child notes, tags, and collections,
 * then assembles them via the pure {@link buildNoteContext}.
 *
 * `tagMemo`/`collectionCache` are per-batch memos (see {@link TagMemo},
 * {@link CollectionCache}) — pass the same instance a caller already used to
 * resolve `item`'s own tags/collections (e.g. for the note-filename template)
 * so this call's fetch for `item.itemID` is free.
 */
export function fetchNoteContext(
  client: NodeDatabaseClient,
  item: Item,
  options: {
    resolvers: NoteResolvers;
    /** The signed-in account username, for {@link NoteTemplateContext.weblink}; `null` when unknown. */
    username: string | null;
    tagMemo?: TagMemo;
    groupIdMemo?: GroupIDMemo;
    collectionCache: CollectionCache;
  },
): NoteTemplateContext {
  const { resolvers, groupIdMemo, collectionCache } = options;
  const tagMemo: TagMemo = options.tagMemo ?? new Map();
  const libraryID = item.libraryID;
  const memo = { memo: groupIdMemo };

  const attachments = getAttachmentsByParents(client, [item.itemID], memo);
  const annotationsByAttachment = new Map<number, Annotation[]>();
  for (const attachment of attachments) {
    annotationsByAttachment.set(
      attachment.itemID,
      getAnnotationsByParent(client, attachment.itemID, memo),
    );
  }
  const annotationIDs = [...annotationsByAttachment.values()].flatMap(
    (annotations) => annotations.map((annotation) => annotation.itemID),
  );

  const relatedItems = getItemsByKey(
    client,
    libraryID,
    getRelatedKeysByItemID(client, item.itemID),
  );
  const relatedItemIDs = relatedItems.map((related) => related.itemID);

  const tagsByItemID = resolveItemTagsByIDs(
    client,
    [item.itemID, ...annotationIDs, ...relatedItemIDs],
    tagMemo,
  );

  // Collections resolve for the main item + related items only — annotations
  // are never collection members. Related items share the item's library.
  const collectionsByItemID = collectionCache.byItemIDs(client, libraryID, [
    item.itemID,
    ...relatedItemIDs,
  ]);

  // `zt.notes` lists eagerly; the import work it triggers stays lazy (queued on
  // the link's first render).
  const childNotes = getChildNotes(client, item.itemID, memo);

  return buildNoteContext({
    item,
    username: options.username,
    attachments,
    annotationsByAttachment,
    tagsByItemID,
    collectionsByItemID,
    relatedItems,
    childNotes,
    resolveChildNote: resolvers.resolveChildNote,
    ...resolvers.item,
    ...resolvers.annotation,
  });
}

/** A parent PDF's reusable template shape, built once per attachment and shared
 *  by every annotation off it. */
interface ParentBundle {
  attachment: Attachment;
  tplAttachment: TemplateAttachment;
  /** `null` when the attachment is standalone (no parent bibliographic item). */
  parentItem: TemplateParentItemData | null;
}

/**
 * Resolve already-fetched {@link Annotation}s to their {@link TemplateAnnotation}s,
 * keyed by annotation key. Annotations sharing a parent PDF read its attachment
 * row, parent item, and tags once: distinct parents are batched, and each
 * parent's template bundle is reused across its annotations. An annotation
 * whose attachment is unresolvable is absent from the result; one on a
 * standalone attachment (no parent bibliographic item) is present with
 * `parentItem: null`.
 *
 * Shared by the drag-insert path (one annotation by item id) and note import's
 * annotation-template prepass (many, by key).
 */
export function fetchAnnotationsTemplateData(
  client: NodeDatabaseClient,
  annotations: readonly Annotation[],
  options: {
    resolvers: AnnotationResolvers;
    tagMemo?: TagMemo;
    groupIdMemo?: GroupIDMemo;
  },
): Map<string, TemplateAnnotation> {
  const result = new Map<string, TemplateAnnotation>();
  if (annotations.length === 0) return result;

  const username = getCurrentUsername(client);
  const { resolvers, groupIdMemo } = options;
  const tagMemo: TagMemo = options.tagMemo ?? new Map();
  const memo = { memo: groupIdMemo };

  const attachments: Attachment[] = [];
  for (const itemID of distinct(annotations.map((a) => a.parentItemID))) {
    const attachment = getAttachmentByItemId(client, itemID, memo);
    if (attachment) attachments.push(attachment);
  }

  const parentIDs = distinct(attachments.map((a) => a.parentItemID));
  const parentItemsByID = new Map(
    getItemsByID(client, parentIDs, memo).map((item) => [item.itemID, item]),
  );

  const tagsByItemID = resolveItemTagsByIDs(
    client,
    [...annotations.map((a) => a.itemID), ...parentIDs],
    tagMemo,
  );

  // Keyed by attachment itemID — equal to each annotation's `parentItemID`.
  const bundleByAttachment = new Map<number, ParentBundle>();
  for (const attachment of attachments) {
    const parentItemData = parentItemsByID.get(attachment.parentItemID);
    // `null` for a standalone attachment (a PDF with no parent bibliographic
    // item) — its parentItemID resolves to nothing.
    let parentItem: TemplateParentItemData | null = null;
    if (parentItemData) {
      const parentBaseData = itemToTemplateBaseData({
        item: parentItemData,
        tags: tagsByItemID.get(parentItemData.itemID) ?? [],
      });
      parentItem = withItemPreview({
        ...parentBaseData,
        // Unresolved: this path runs synchronously on dragstart and stays
        // cheap by design (see zt-template-item.ts's TemplateParentItemData).
        notePath: null,
        noteLink: () => null,
        ...resolveItemCore({
          item: parentItemData,
          baseData: parentBaseData,
          username,
          authorsShort: resolvers.authorsShort,
        }),
      });
    }
    bundleByAttachment.set(attachment.itemID, {
      attachment,
      parentItem,
      tplAttachment: resolveTemplateAttachment(attachment, resolvers),
    });
  }

  for (const annotation of annotations) {
    const bundle = bundleByAttachment.get(annotation.parentItemID);
    if (!bundle) continue;
    result.set(
      annotation.key,
      annotationToTemplateData({
        annotation,
        tags: tagsByItemID.get(annotation.itemID) ?? [],
        getParentAttachment: () => bundle.tplAttachment,
        getParentItem: () => bundle.parentItem,
        commentToMarkdown: resolvers.commentToMarkdown,
        annotationImageLink: resolvers.annotationImageLink,
        fileLink: (page) => resolvers.fileLink(bundle.attachment, page),
      }),
    );
  }
  return result;
}
