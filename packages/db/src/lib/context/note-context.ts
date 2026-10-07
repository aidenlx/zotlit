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
import { toTemplateCollection } from "@/lib/zt-collection";
import type { CollectionCache, TemplateCollection } from "@/lib/zt-collection";
import type { ItemTag } from "@/lib/zt-tag";
import type { GroupIDMemo } from "@/queries/_groups";
import { getZoteroIdentity } from "@/queries/account";
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
 * Every database row a Literature Note's `zt` root needs, as plain data: no
 * functions, and `Temporal.Instant` as the only class instance besides `Map`
 * and `Array`. {@link fetchNoteSource} reads it; {@link buildNoteContextFromSource}
 * turns it into a {@link NoteTemplateContext} with the caller's resolvers.
 */
export interface NoteSource {
  item: Item;
  /** The signed-in account username, for {@link NoteTemplateContext.weblink}; `null` when unknown. */
  username: string | null;
  /** The item's attachments, in display order. */
  attachments: readonly Attachment[];
  /** Annotations keyed by their parent attachment's `itemID`. */
  annotationsByAttachment: ReadonlyMap<number, readonly Annotation[]>;
  /** Tag applications keyed by Zotero itemID: the item, its annotations, its related items. */
  tagsByItemID: ReadonlyMap<number, readonly ItemTag[]>;
  /**
   * Collections keyed by Zotero itemID, for the item and its related items.
   * Plain records: the build gives each its string coercion.
   */
  collectionsByItemID: ReadonlyMap<number, readonly TemplateCollection[]>;
  /** Items related to {@link item}, already resolved. */
  relatedItems: readonly Item[];
  /** The item's child notes. */
  childNotes: readonly ChildNote[];
}

/**
 * Read the {@link NoteSource} for `item`: its attachments, annotations, related
 * items, child notes, tags, and collections. Every database read of the
 * Literature Note path happens here.
 *
 * `tagMemo`/`collectionCache` are per-batch memos (see {@link TagMemo},
 * {@link CollectionCache}) — pass the same instance a caller already used to
 * resolve `item`'s own tags/collections (e.g. for the note-filename template)
 * so this call's fetch for `item.itemID` is free.
 */
export function fetchNoteSource(
  client: NodeDatabaseClient,
  item: Item,
  options: {
    /**
     * The signed-in account username. Omitted, it is read from the database;
     * pass `null` to build the note as a never-synced account does.
     */
    username?: string | null;
    tagMemo?: TagMemo;
    groupIdMemo?: GroupIDMemo;
    collectionCache: CollectionCache;
  },
): NoteSource {
  const { groupIdMemo, collectionCache } = options;
  const tagMemo: TagMemo = options.tagMemo ?? new Map();
  const libraryID = item.libraryID;
  const memo = { memo: groupIdMemo };
  const username =
    options.username === undefined
      ? getZoteroIdentity(client).username
      : options.username;

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
  const collectionsByItemID = new Map(
    [
      ...collectionCache.byItemIDs(client, libraryID, [
        item.itemID,
        ...relatedItemIDs,
      ]),
    ].map(([itemID, collections]) => [
      itemID,
      // Spread keeps the enumerable fields and drops the string coercion.
      collections.map((collection) => ({ ...collection })),
    ]),
  );

  // `zt.notes` lists eagerly; the import work it triggers stays lazy (queued on
  // the link's first render).
  const childNotes = getChildNotes(client, item.itemID, memo);

  return {
    item,
    username,
    attachments,
    annotationsByAttachment,
    tagsByItemID,
    collectionsByItemID,
    relatedItems,
    childNotes,
  };
}

/**
 * Assemble the full {@link NoteTemplateContext} from a {@link NoteSource} via
 * the pure {@link buildNoteContext}. Reads no database; the resolvers run here
 * only.
 */
export function buildNoteContextFromSource(
  source: NoteSource,
  resolvers: NoteResolvers,
): NoteTemplateContext {
  return buildNoteContext({
    ...source,
    collectionsByItemID: new Map(
      [...source.collectionsByItemID].map(([itemID, collections]) => [
        itemID,
        collections.map(toTemplateCollection),
      ]),
    ),
    resolveChildNote: resolvers.resolveChildNote,
    ...resolvers.item,
    ...resolvers.annotation,
  });
}

/**
 * Build the full {@link NoteTemplateContext} for `item`: {@link fetchNoteSource}
 * followed by {@link buildNoteContextFromSource}.
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
  const { resolvers, ...memos } = options;
  return buildNoteContextFromSource(
    fetchNoteSource(client, item, memos),
    resolvers,
  );
}

/** A parent PDF's reusable template shape, built once per attachment and shared
 *  by every annotation off it. */
interface ParentBundle {
  attachment: Attachment;
  tplAttachment: TemplateAttachment;
  /** `null` when the attachment is standalone (no parent bibliographic item). */
  parentItem: TemplateParentItemData | null;
}

/** Parent facts for a captured Annotation that may precede its SQLite row. */
export function fetchAnnotationParentContext(
  client: NodeDatabaseClient,
  attachment: Attachment,
  resolvers: AnnotationResolvers,
): Pick<ParentBundle, "parentItem" | "tplAttachment"> {
  const item = getItemsByID(client, [attachment.parentItemID])[0];
  let parentItem: TemplateParentItemData | null = null;
  if (item) {
    const tags = resolveItemTagsByIDs(client, [item.itemID], new Map());
    const baseData = itemToTemplateBaseData({
      item,
      tags: tags.get(item.itemID) ?? [],
    });
    parentItem = withItemPreview({
      ...baseData,
      notePath: null,
      noteLink: () => null,
      ...resolveItemCore({
        item,
        baseData,
        username: getZoteroIdentity(client).username,
        authorsShort: resolvers.authorsShort,
      }),
    });
  }
  return {
    parentItem,
    tplAttachment: resolveTemplateAttachment(attachment, resolvers),
  };
}

/**
 * Every database row an Annotation's template data needs, as plain data (see
 * {@link NoteSource}). {@link fetchAnnotationSources} reads it;
 * {@link buildAnnotationsTemplateData} turns it into template data.
 */
export interface AnnotationSources {
  annotations: readonly Annotation[];
  /** The annotations' distinct resolvable parent attachments. */
  attachments: readonly Attachment[];
  /** The attachments' parent items; a standalone attachment has none. */
  parentItems: readonly Item[];
  /** Tag applications keyed by Zotero itemID: the annotations and the parent items. */
  tagsByItemID: ReadonlyMap<number, readonly ItemTag[]>;
  /** The signed-in account username, for the parent item's web link; `null` when unknown. */
  username: string | null;
}

/**
 * Read the {@link AnnotationSources} for already-fetched {@link Annotation}s.
 * Annotations sharing a parent PDF read its attachment row, parent item, and
 * tags once: distinct parents are batched. Every database read of the
 * annotation path happens here.
 */
export function fetchAnnotationSources(
  client: NodeDatabaseClient,
  annotations: readonly Annotation[],
  options: {
    tagMemo?: TagMemo;
    groupIdMemo?: GroupIDMemo;
    /**
     * The signed-in account username, for the parent item's
     * {@link TemplateParentItemData.weblink}. Omitted, the signed-in account is
     * read from the database; pass `null` to build the parent item as a
     * never-synced account does, with no personal-library web link.
     */
    username?: string | null;
  },
): AnnotationSources {
  if (annotations.length === 0) {
    return {
      annotations,
      attachments: [],
      parentItems: [],
      tagsByItemID: new Map(),
      username: options.username ?? null,
    };
  }

  const username =
    options.username === undefined
      ? getZoteroIdentity(client).username
      : options.username;
  const { groupIdMemo } = options;
  const tagMemo: TagMemo = options.tagMemo ?? new Map();
  const memo = { memo: groupIdMemo };

  const attachments: Attachment[] = [];
  for (const itemID of distinct(annotations.map((a) => a.parentItemID))) {
    const attachment = getAttachmentByItemId(client, itemID, memo);
    if (attachment) attachments.push(attachment);
  }

  const parentIDs = distinct(attachments.map((a) => a.parentItemID));
  const parentItems = getItemsByID(client, parentIDs, memo);

  const tagsByItemID = resolveItemTagsByIDs(
    client,
    [...annotations.map((a) => a.itemID), ...parentIDs],
    tagMemo,
  );

  return { annotations, attachments, parentItems, tagsByItemID, username };
}

/**
 * Resolve {@link AnnotationSources} to {@link TemplateAnnotation}s, keyed by
 * annotation key. Each parent's template bundle is built once and reused across
 * its annotations. An annotation whose attachment is unresolvable is absent
 * from the result; one on a standalone attachment (no parent bibliographic
 * item) is present with `parentItem: null`. Reads no database; the resolvers
 * run here only.
 */
export function buildAnnotationsTemplateData(
  sources: AnnotationSources,
  resolvers: AnnotationResolvers,
): Map<string, TemplateAnnotation> {
  const { annotations, attachments, tagsByItemID, username } = sources;
  const result = new Map<string, TemplateAnnotation>();
  const parentItemsByID = new Map(
    sources.parentItems.map((item) => [item.itemID, item]),
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
        fileLink: (anchor) => resolvers.fileLink(bundle.attachment, anchor),
      }),
    );
  }
  return result;
}

/**
 * Resolve already-fetched {@link Annotation}s to their {@link TemplateAnnotation}s,
 * keyed by annotation key: {@link fetchAnnotationSources} followed by
 * {@link buildAnnotationsTemplateData}.
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
    /**
     * The signed-in account username, for the parent item's
     * {@link TemplateParentItemData.weblink}. Omitted, the signed-in account is
     * read from the database; pass `null` to build the parent item as a
     * never-synced account does, with no personal-library web link.
     */
    username?: string | null;
  },
): Map<string, TemplateAnnotation> {
  const { resolvers, ...memos } = options;
  return buildAnnotationsTemplateData(
    fetchAnnotationSources(client, annotations, memos),
    resolvers,
  );
}
