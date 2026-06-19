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
} from "./zt-template-item";
import { annotationOpenUri, itemSelectUri } from "./zt-uri";

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
}

export interface NoteContextInput {
  item: Item;
  /** The item's attachments, in display order. */
  attachments: readonly Attachment[];
  /** Annotations keyed by their parent attachment's `itemID`. */
  annotationsByAttachment: ReadonlyMap<number, readonly Annotation[]>;
  /** Tag applications keyed by Zotero itemID. */
  tagsByItemID: ReadonlyMap<number, readonly ItemTag[]>;
  /** Short author summary (e.g. `"Smith et al."`). */
  authorsShort: string;
  /** Resolve an attachment to its vault link; `""` when unresolvable. */
  fileLink: (attachment: Attachment) => string;
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
  const itemData = itemToTemplateData(item, itemTags);
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

  const authors: TemplateCreator[] = itemData.primaryCreatorType
    ? itemData.creators.filter((c) => c.role === itemData.primaryCreatorType)
    : [...itemData.creators];

  return {
    ...itemData,
    backlink: itemSelectUri(item.key, groupID),
    annotations,
    attachments,
    authors,
    authorsShort: input.authorsShort,
  };
}
