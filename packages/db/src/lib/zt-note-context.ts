import { type Item } from "@/queries/items";

import { type Annotation } from "./zt-annot";
import { type Attachment } from "./zt-attach";
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
  type TemplateItemData,
  type TemplateItemResolvers,
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
   * Items related to {@link item} via Zotero's "Related" panel, already
   * resolved (trashed / unresolvable relations omitted). Each is mapped to a
   * {@link TemplateRelatedItem} and title-sorted.
   */
  relatedItems: readonly Item[];
  /** Short author summary (e.g. `"Smith et al."`) for any item. */
  authorsShort: (item: Item) => string;
  /** Resolve an attachment to its vault link; `""` when unresolvable. */
  fileLink: (attachment: Attachment) => string;
  /** Resolve an item to its full vault-relative literature note path. */
  notePath: (item: TemplateItemData) => string;
  /** Resolve an item to its Obsidian Markdown literature-note link. */
  noteLink: (item: TemplateItemData, alias?: string) => string;
  /**
   * Resolve an annotation's image-excerpt embed, or `null` when the annotation
   * type has no cached image.
   */
  imgEmbed: (annotation: Annotation) => string | null;
}

/**
 * Assemble the {@link NoteTemplateContext} from raw DB rows plus the runtime
 * resolvers the query layer deliberately omits. Pure: all I/O (DB fetch, path
 * resolution) is done by the caller and passed in.
 */
export function buildNoteContext(input: NoteContextInput): NoteTemplateContext {
  const { item } = input;
  const itemTags = input.tagsByItemID.get(item.itemID) ?? [];
  const noteResolvers: TemplateItemResolvers = {
    notePath: input.notePath,
    noteLink: input.noteLink,
  };
  const itemData = itemToTemplateData(item, itemTags, noteResolvers);
  const groupID = parseIndexedKey(item.indexedKey)?.groupID ?? null;

  const attachments: TemplateAttachment[] = input.attachments.map((a) => ({
    ...attachmentToTemplateData(a),
    fileLink: input.fileLink(a),
  }));

  const annotations: TemplateAnnotation[] = [];
  input.attachments.forEach((attachment, i) => {
    const parentAttachment = attachments[i]!;
    const annots = input.annotationsByAttachment.get(attachment.itemID) ?? [];
    for (const annot of annots) {
      annotations.push({
        ...annotationToTemplateData(
          annot,
          input.tagsByItemID.get(annot.itemID) ?? [],
        ),
        imgEmbed: input.imgEmbed(annot),
        backlink: annotationOpenUri({
          attachmentKey: attachment.key,
          annotationKey: annot.key,
          pageLabel: annot.pageLabel,
          groupID,
        }),
        parentItem: itemData,
        parentAttachment,
      });
    }
  });

  const relatedItems = input.relatedItems
    .map((related) =>
      buildRelatedItem({
        item: related,
        tags: input.tagsByItemID.get(related.itemID) ?? [],
        authorsShort: input.authorsShort(related),
        noteResolvers,
      }),
    )
    .sort(byTitle);

  return {
    ...itemData,
    backlink: itemSelectUri(item.key, groupID),
    annotations,
    attachments,
    authors: selectPrimaryAuthors(itemData),
    authorsShort: input.authorsShort(item),
    relatedItems,
  };
}

/** Creators filtered to the item's primary creator type; all when none. */
function selectPrimaryAuthors(data: TemplateItemData): TemplateCreator[] {
  return data.primaryCreatorType
    ? data.creators.filter((c) => c.role === data.primaryCreatorType)
    : [...data.creators];
}

function buildRelatedItem({
  item,
  tags,
  authorsShort,
  noteResolvers,
}: {
  item: Item;
  tags: readonly ItemTag[];
  authorsShort: string;
  noteResolvers: TemplateItemResolvers;
}): TemplateRelatedItem {
  const itemData = itemToTemplateData(item, tags, noteResolvers);
  const groupID = parseIndexedKey(item.indexedKey)?.groupID ?? null;
  return {
    ...itemData,
    backlink: itemSelectUri(item.key, groupID),
    authors: selectPrimaryAuthors(itemData),
    authorsShort,
  };
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
