import { type Temporal } from "@zotlit/shared/temporal";

import { annotationTypeToName, type Annotation } from "./zt-annot";
import { annotationColorToName, type AnnotationColorName } from "./zt-color";
import { type ItemTag } from "./zt-tag";
import { type TemplateAttachment } from "./zt-template-attach";
import { type TemplateItemData } from "./zt-template-item";

/**
 * Annotation data in the v2 template vocabulary. Exposed on `zt.annotations`
 * and as the `zt` root of the single-annotation template.
 *
 * Drops DB-internal fields (`itemID`, `parentItemID`, `parentKey`, `sortIndex`,
 * `position`) — `parentAttachment.key` carries the parent reference.
 */
export interface TemplateAnnotation {
  key: string;
  libraryID: number;
  /** Annotation type: `"highlight"`, `"note"`, `"image"`, `"ink"`, etc. */
  type: string;
  text: string | null;
  comment: string | null;
  /** Hex color, e.g. `"#ffd400"`. */
  colorHex: string | null;
  /** Color name, e.g. `"yellow"`. */
  colorName: AnnotationColorName | null;
  pageLabel: string | null;
  authorName: string | null;
  isExternal: boolean;
  dateAdded: Temporal.Instant;
  dateModified: Temporal.Instant;
  tags: readonly ItemTag[];

  /**
   * Image-excerpt embed (e.g. `![[image.png]]`); `null` for annotation types
   * that have no cached excerpt image (everything but `image` and `ink`).
   * Computed at the app layer.
   */
  imgEmbed: string | null;
  /** Zotero deep link to this annotation. Computed at the app layer. */
  backlink: string;

  /** Parent literature item; shared across annotations from the same item. */
  parentItem: TemplateItemData;
  /** Source attachment; shared across annotations from the same attachment. */
  parentAttachment: TemplateAttachment;
}

/**
 * Map a DB {@link Annotation} to its template shape. Runtime fields
 * (`imgEmbed`, `backlink`) and parent references are omitted — they are filled
 * by the Obsidian-side note-create flow.
 */
export function annotationToTemplateData(
  annotation: Annotation,
  tags: readonly ItemTag[],
): Omit<
  TemplateAnnotation,
  "imgEmbed" | "backlink" | "parentItem" | "parentAttachment"
> {
  return {
    key: annotation.key,
    libraryID: annotation.libraryID,
    type: annotationTypeToName(annotation.type),
    text: annotation.text,
    comment: annotation.comment,
    colorHex: annotation.color,
    colorName: annotationColorToName(annotation.color),
    pageLabel: annotation.pageLabel,
    authorName: annotation.authorName,
    isExternal: annotation.isExternal,
    dateAdded: annotation.dateAdded,
    dateModified: annotation.dateModified,
    tags,
  };
}
