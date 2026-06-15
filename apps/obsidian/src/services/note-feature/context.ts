import {
  annotationOpenUri,
  annotationToTemplateData,
  attachmentToTemplateData,
  itemSelectUri,
  itemToTemplateData,
  parseIndexedKey,
  type Annotation,
  type Attachment,
  type Item,
  type ItemTag,
  type TemplateAnnotation,
  type TemplateAttachment,
  type TemplateCreator,
} from "@zotlit/db";

import { type NoteTemplateContext } from "./types";

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
  /** Resolve an annotation image excerpt to its vault embed. */
  imgEmbed: (annotation: Annotation, parentAttachment: Attachment) => string;
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
        imgEmbed: input.imgEmbed(annot, attachment),
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
