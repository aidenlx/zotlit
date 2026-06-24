import { type Temporal } from "@zotlit/shared/temporal";

import { annotationTypeToName, type Annotation } from "./zt-annot";
import { annotationColorToName, type AnnotationColorName } from "./zt-color";
import { type ItemTag } from "./zt-tag";
import { type TemplateAttachment } from "./zt-template-attach";
import { type TemplateItemData, type TemplateLink } from "./zt-template-item";

/**
 * Annotation data in the v2 template vocabulary. Exposed on `zt.annotations`
 * and as the `zt` root of the single-annotation template.
 *
 * Drops DB-internal fields (`itemID`, `parentItemID`, `parentKey`, `sortIndex`,
 * `position`) — `parentAttachment.key` carries the parent reference, and the
 * position survives only as the derived 1-based {@link TemplateAnnotation.page}.
 */
export interface TemplateAnnotation {
  key: string;
  libraryID: number;
  /** Annotation type: `"highlight"`, `"note"`, `"image"`, `"ink"`, etc. */
  type: string;
  text: string | null;
  /**
   * Raw comment HTML as stored by Zotero — "plain text flavored with some HTML
   * tags" (only `<i>`/`<b>`/`<sub>`/`<sup>` plus `\n` line breaks); `null` when
   * there is no comment. For rendered Markdown use {@link comment}.
   */
  commentHtml: string | null;
  /** Hex color, e.g. `"#ffd400"`. */
  colorHex: string | null;
  /** Color name, e.g. `"yellow"`. */
  colorName: AnnotationColorName | null;
  pageLabel: string | null;
  /**
   * 1-based page number derived from the PDF position (`pageIndex + 1`); `null`
   * for annotations with no page index (EPUB / snapshot). Unlike
   * {@link pageLabel} this ignores the document's own page labelling.
   */
  page: number | null;
  authorName: string | null;
  isExternal: boolean;
  dateAdded: Temporal.Instant;
  dateModified: Temporal.Instant;
  tags: readonly ItemTag[];

  /**
   * Markdown link to the excerpt image, or `null` for annotation types with no
   * cached excerpt image (everything but `image` and `ink`). Call it to render
   * and prefix `!` for an embed — `![...]` becomes the image. With image import
   * disabled it links the cached image's `file://` URI; with import enabled it
   * links the in-vault copy, formatted per the vault's wikilink preference. Pass
   * `alias` to override the display text (defaults to the image filename). See
   * {@link TemplateLink}. Computed at the app layer.
   */
  imgLink: TemplateLink | null;
  /** {@link commentHtml} converted to Markdown; `null` when there is no comment. Computed at the app layer. */
  comment: string | null;
  /**
   * Markdown link to the parent attachment file, deep-linked to this
   * annotation's {@link page} (`#page=N`); `""` when the file is unresolvable.
   * Call it to render — pass `alias`/`subpath` to override the display text or
   * the `#`-fragment. See {@link TemplateLink}. Computed at the app layer.
   */
  fileLink: TemplateLink;
  /** Zotero deep link to this annotation. Computed at the app layer. */
  backlink: string;

  /** Parent literature item; shared across annotations from the same item. */
  parentItem: TemplateItemData;
  /** Source attachment; shared across annotations from the same attachment. */
  parentAttachment: TemplateAttachment;
}

/**
 * Map a DB {@link Annotation} to its template shape. App-layer fields
 * (`imgLink`, `comment`, `fileLink`, `backlink`) and parent references are
 * omitted — they are filled by the Obsidian-side note-create flow.
 */
export function annotationToTemplateData(
  annotation: Annotation,
  tags: readonly ItemTag[],
): Omit<
  TemplateAnnotation,
  | "imgLink"
  | "comment"
  | "fileLink"
  | "backlink"
  | "parentItem"
  | "parentAttachment"
> {
  const pageIndex = annotation.position.pageIndex;
  return {
    key: annotation.key,
    libraryID: annotation.libraryID,
    type: annotationTypeToName(annotation.type),
    text: annotation.text,
    commentHtml: annotation.comment,
    colorHex: annotation.color,
    colorName: annotationColorToName(annotation.color),
    pageLabel: annotation.pageLabel,
    page: typeof pageIndex === "number" ? pageIndex + 1 : null,
    authorName: annotation.authorName,
    isExternal: annotation.isExternal,
    dateAdded: annotation.dateAdded,
    dateModified: annotation.dateModified,
    tags,
  };
}
