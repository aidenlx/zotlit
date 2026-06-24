import { type Item } from "@/queries/items";

import { type Annotation } from "./zt-annot";
import { type Attachment } from "./zt-attach";
import { type TemplateCollection } from "./zt-collection";
import { parseIndexedKey } from "./zt-key";
import { type ItemTag } from "./zt-tag";
import {
  annotationToTemplateData,
  type TemplateAnnotation,
} from "./zt-template-annot";
import {
  attachmentToTemplateData,
  type TemplateAttachment,
} from "./zt-template-attach";
import {
  itemToTemplateData,
  type TemplateCreator,
  type TemplateItemBaseData,
  type TemplateItemData,
  type TemplateItemResolvers,
  type TemplateLink,
} from "./zt-template-item";
import { annotationOpenUri, itemSelectUri } from "./zt-uri";

/**
 * A single entry in {@link NoteTemplateContext.relatedItems}: the related
 * item's own {@link TemplateItemData}, flattened with its backlink and author
 * conveniences. Depth-1 — its own `annotations`, `attachments`, and
 * `relatedItems` are deliberately absent (resolving them would require a
 * per-related-item DB fan-out), marking the boundary of the relation graph.
 */
export interface TemplateRelatedItem extends TemplateItemData {
  /** Zotero deep link to the related item (`zotero://select/...`). */
  backlink: string;
  /** Creators filtered to {@link TemplateItemData.primaryCreatorType}. */
  authors: TemplateCreator[];
  /** Formatted short author string, e.g. `"Smith et al."`. */
  authorsShort: string;
}

/**
 * The `zt` root for the `note` template: {@link TemplateItemData} plus the
 * runtime-computed fields assembled at the app layer (backlinks, resolved
 * attachment links, flattened annotations, author conveniences).
 */
export interface NoteTemplateContext extends TemplateItemData {
  /** Zotero deep link to the literature item (`zotero://select/...`). */
  backlink: string;
  /** Flat annotation list across all (or scoped) attachments. */
  annotations: TemplateAnnotation[];
  /** All attachments for the item. */
  attachments: TemplateAttachment[];
  /** Creators filtered to {@link TemplateItemData.primaryCreatorType}. */
  authors: TemplateCreator[];
  /** Formatted short author string, e.g. `"Smith et al."`. */
  authorsShort: string;
  /**
   * Items from Zotero's "Related" panel (`dc:relation`), sorted by title.
   * Same-library, forward-only, depth-1.
   */
  relatedItems: TemplateRelatedItem[];
}

export interface NoteContextInput {
  item: Item;
  /** The item's attachments, in display order. */
  attachments: readonly Attachment[];
  /** Annotations keyed by their parent attachment's `itemID`. */
  annotationsByAttachment: ReadonlyMap<number, readonly Annotation[]>;
  /** Tag applications keyed by Zotero itemID. */
  tagsByItemID: ReadonlyMap<number, readonly ItemTag[]>;
  /**
   * Resolved collections keyed by Zotero itemID, for the main item and related
   * items only — annotations are never collection members, so they are absent.
   */
  collectionsByItemID: ReadonlyMap<number, readonly TemplateCollection[]>;
  /**
   * Items related to {@link item} via Zotero's "Related" panel, already
   * resolved (trashed / unresolvable relations omitted). Each is mapped to a
   * {@link TemplateRelatedItem} and title-sorted.
   */
  relatedItems: readonly Item[];
  /** Short author summary (e.g. `"Smith et al."`) for any item. */
  authorsShort: (item: Item) => string;
  /** Resolve an attachment to its absolute on-disk path; `null` when unresolvable. */
  filePath: (attachment: Attachment) => string | null;
  /**
   * Build an attachment's file-link helper. Pass a 1-based `page` to default the
   * helper's subpath to `#page=N` (annotation-level links anchor to their page);
   * the helper returns `""` when the file is unresolvable.
   */
  fileLink: (attachment: Attachment, page?: number | null) => TemplateLink;
  /** Resolve an item to its full vault-relative literature note path. */
  notePath: (item: TemplateItemData) => string;
  /** Resolve an item to its Obsidian Markdown literature-note link. */
  noteLink: (
    item: TemplateItemData,
    alias?: string,
    subpath?: string,
  ) => string;
  /**
   * Build an annotation's excerpt-image link helper, or `null` when the
   * annotation type has no cached image. Prefix `!` to the rendered link for an
   * embed.
   */
  annotationImageLink: (annotation: Annotation) => TemplateLink | null;
  /**
   * Convert an annotation's raw comment HTML to Markdown. Called lazily, only
   * when a template reads `zt.comment`, so the conversion is skipped otherwise.
   */
  commentToMarkdown: (html: string) => string;
}

/**
 * The minimal `zt` root for the **note-filename** template: an item's own
 * {@link TemplateItemData} and nothing else. Unlike {@link buildNoteContext}
 * this resolves no attachments, annotations, related items, or app-layer
 * resolvers — `notePath` / `noteLink()` return `""` — so a filename query
 * stays a single-item read. Pure: the caller passes the item's tags and
 * collections in.
 */
export function buildFilenameContext(input: {
  item: Item;
  tags: readonly ItemTag[];
  collections: readonly TemplateCollection[];
}): TemplateItemData {
  return {
    ...itemToTemplateData({
      item: input.item,
      tags: input.tags,
      collections: input.collections,
    }),
    notePath: "",
    noteLink: () => "",
  };
}

/**
 * Assemble the {@link NoteTemplateContext} from raw DB rows plus the runtime
 * resolvers the query layer deliberately omits. Pure: all I/O (DB fetch, path
 * resolution) is done by the caller and passed in.
 */
export function buildNoteContext(input: NoteContextInput): NoteTemplateContext {
  const { item } = input;
  const noteResolvers: TemplateItemResolvers = {
    notePath: input.notePath,
    noteLink: input.noteLink,
  };
  const baseData = itemToTemplateData({
    item,
    tags: input.tagsByItemID.get(item.itemID) ?? [],
    collections: input.collectionsByItemID.get(item.itemID) ?? [],
  });
  const groupID = parseIndexedKey(item.indexedKey)?.groupID ?? null;

  const attachments: TemplateAttachment[] = input.attachments.map((a) => ({
    ...attachmentToTemplateData(a),
    filePath: input.filePath(a),
    fileLink: input.fileLink(a),
  }));

  const annotations: TemplateAnnotation[] = [];
  // `result` is referenced inside annotation objects (`parentItem`) and inside
  // lazy getters; it is only read after this function returns.
  let result: NoteTemplateContext;

  input.attachments.forEach((attachment, i) => {
    const parentAttachment = attachments[i]!;
    const annots = input.annotationsByAttachment.get(attachment.itemID) ?? [];
    for (const annot of annots) {
      const data = annotationToTemplateData(
        annot,
        input.tagsByItemID.get(annot.itemID) ?? [],
      );
      let comment: string | null | undefined;
      annotations.push({
        ...data,
        imgLink: input.annotationImageLink(annot),
        get comment() {
          if (comment === undefined) {
            comment = data.commentHtml
              ? input.commentToMarkdown(data.commentHtml)
              : null;
          }
          return comment;
        },
        fileLink: input.fileLink(attachment, data.page),
        backlink: annotationOpenUri({
          attachmentKey: attachment.key,
          annotationKey: annot.key,
          pageLabel: annot.pageLabel,
          groupID,
        }),
        get parentItem() {
          return result;
        },
        parentAttachment,
      });
    }
  });

  const relatedItems = input.relatedItems
    .map((related) =>
      buildRelatedItem({
        item: related,
        tags: input.tagsByItemID.get(related.itemID) ?? [],
        collections: input.collectionsByItemID.get(related.itemID) ?? [],
        authorsShort: input.authorsShort(related),
        noteResolvers,
      }),
    )
    .sort(byTitle);

  result = {
    ...baseData,
    get notePath() {
      return noteResolvers.notePath(result);
    },
    noteLink(alias?: string, subpath?: string) {
      return noteResolvers.noteLink(result, alias, subpath);
    },
    backlink: itemSelectUri(item.key, groupID),
    annotations,
    attachments,
    authors: selectPrimaryAuthors(baseData),
    authorsShort: input.authorsShort(item),
    relatedItems,
  };
  return result;
}

/** Creators filtered to the item's primary creator type; all when none. */
function selectPrimaryAuthors(data: TemplateItemBaseData): TemplateCreator[] {
  return data.primaryCreatorType
    ? data.creators.filter((c) => c.role === data.primaryCreatorType)
    : [...data.creators];
}

function buildRelatedItem({
  item,
  tags,
  collections,
  authorsShort,
  noteResolvers,
}: {
  item: Item;
  tags: readonly ItemTag[];
  collections: readonly TemplateCollection[];
  authorsShort: string;
  noteResolvers: TemplateItemResolvers;
}): TemplateRelatedItem {
  const baseData = itemToTemplateData({ item, tags, collections });
  const groupID = parseIndexedKey(item.indexedKey)?.groupID ?? null;
  const result: TemplateRelatedItem = {
    ...baseData,
    get notePath() {
      return noteResolvers.notePath(result);
    },
    noteLink(alias?: string, subpath?: string) {
      return noteResolvers.noteLink(result, alias, subpath);
    },
    backlink: itemSelectUri(item.key, groupID),
    authors: selectPrimaryAuthors(baseData),
    authorsShort,
  };
  return result;
}

/**
 * Locale-aware title sort approximating Zotero's Related panel ordering;
 * untitled items sort last. Diverges from Zotero intentionally: no
 * article-stripping or display-title fallback (`getSortTitle`).
 */
function byTitle(a: TemplateRelatedItem, b: TemplateRelatedItem): number {
  const at = a.title ?? "";
  const bt = b.title ?? "";
  if (!at && !bt) return 0;
  if (!at) return 1;
  if (!bt) return -1;
  return at.localeCompare(bt);
}
