import { type Temporal } from "@zotlit/shared/temporal";

import { defineToString } from "@/lib/to-string";
import {
  annotationTypeToName,
  type Annotation,
  type ResolvedAnnotationTypeName,
} from "@/lib/zt-annot";
import {
  annotationColorToName,
  type AnnotationColorName,
} from "@/lib/zt-color";
import { toTemplateTag, type ItemTag, type TemplateTag } from "@/lib/zt-tag";
import { annotationOpenUri } from "@/lib/zt-uri";

import { emptyToNull } from "./normalize";
import { type TemplateAttachment } from "./zt-template-attach";
import {
  type FallibleTemplateLink,
  type TemplateLink,
  type TemplateParentItemData,
} from "./zt-template-item";

/**
 * Annotation data in the v2 template vocabulary. Exposed on `zt.annotations`
 * and as the `zt` root of the single-annotation template.
 *
 * Drops DB-internal fields (`itemID`, `parentItemID`, `parentKey`, `sortIndex`,
 * `position`) — `parentAttachment.key` carries the parent reference, and the
 * position survives only as the derived {@link TemplateAnnotation.page}.
 */
export interface TemplateAnnotationBaseData {
  /** Zotero item key of the annotation. */
  key: string;
  /** {@link key} for the personal library, `KEYgGROUPID` for a group library. */
  indexedKey: string;
  /** Zotero library ID holding the annotation. */
  libraryID: number;
  /**
   * Annotation kind: `"highlight"`, `"note"`, `"image"`, `"ink"`,
   * `"underline"`, or `"text"`; `"unknown"` for a type Zotero added after this
   * release.
   */
  type: ResolvedAnnotationTypeName;
  /**
   * The highlighted or underlined excerpt; `null` when the type carries none.
   * Verbatim as Zotero stores it, so it can hold the attribute-free inline tags
   * the reader's editor allows (`<i>`, `<b>`, `<sub>`, `<sup>`).
   */
  text: string | null;
  /**
   * Raw comment HTML as stored by Zotero — "plain text flavored with some HTML
   * tags" (only `<i>`/`<b>`/`<sub>`/`<sup>` plus `\n` line breaks); `null` when
   * there is no comment. For rendered Markdown use {@link comment}.
   */
  commentHtml: string | null;
  /** Hex color, e.g. `"#ffd400"`. */
  colorHex: string | null;
  /**
   * Zotero palette name — `"yellow"`, `"red"`, `"green"`, `"blue"`,
   * `"purple"`, `"magenta"`, `"orange"`, `"gray"`, or `"plum"`; `null` when
   * {@link TemplateAnnotationBaseData.colorHex} is absent or holds a custom
   * color outside the palette.
   */
  colorName: AnnotationColorName | null;
  /** Page label as the document itself shows it, e.g. `"42"`, `"iv"`. */
  pageLabel: string | null;
  /**
   * 1-based page number derived from the PDF position (`pageIndex + 1`); `null`
   * for annotations with no page index (EPUB / snapshot). Unlike
   * {@link pageLabel} this ignores the document's own page labelling.
   */
  page: number | null;
  /** Annotation author as stored on the annotation row; `null` when the row records none. */
  authorName: string | null;
  /** Whether Zotero marks the annotation as external. */
  isExternal: boolean;
  /** When the annotation was created. Second precision, like an item's timestamps. */
  dateAdded: Temporal.Instant;
  /** When the annotation was last modified; same precision as {@link dateAdded}. */
  dateModified: Temporal.Instant;
  /** Tags applied to this annotation. */
  tags: readonly TemplateTag[];
}

/**
 * One annotation with its app-layer links resolved: an entry of
 * `zt.annotations` on the note root, and the base of the single-annotation
 * root {@link AnnotationTemplateContext}.
 */
export interface TemplateAnnotation extends TemplateAnnotationBaseData {
  /**
   * Markdown link to the excerpt image, or `null` for annotation types with no
   * cached excerpt image (everything but `image` and `ink`), which resolves
   * empty. Call it to render and pipe it through the `embed` filter (or prefix
   * `!` yourself) for an Obsidian embed. With image import
   * disabled it links the cached image's `file://` URI; with import enabled it
   * links the in-vault copy, formatted per the vault's wikilink preference. Pass
   * `alias` to override the display text (defaults to the image filename). See
   * {@link TemplateLink}. Computed at the app layer.
   *
   * @ztFilter img_link
   * @example
   * ```liquid
   * {% for annot in zt.annotations %}{{ annot | img_link | embed }}{% endfor %}
   * ```
   */
  imgLink: TemplateLink | null;
  /** {@link commentHtml} converted to Markdown; `null` when there is no comment. Computed at the app layer. */
  comment: string | null;
  /**
   * Markdown link to the parent attachment file, deep-linked to this
   * annotation's {@link page} (`#page=N`); `null` when the file is unresolvable.
   * Call it to render — pass `alias`/`subpath` to override the display text or
   * the `#`-fragment. See {@link FallibleTemplateLink}. Computed at the app layer.
   *
   * @ztFilter file_link
   */
  fileLink: FallibleTemplateLink;
  /** Zotero deep link to this annotation. Computed at the app layer. */
  backlink: string;

  /**
   * Parent literature item; shared across annotations from the same item.
   * `null` for an annotation on a standalone attachment (a file with no
   * parent bibliographic item).
   *
   * Its `collections` are populated when the annotation renders as part of a
   * note; see {@link TemplateParentItemData} for the standalone case.
   */
  parentItem: TemplateParentItemData | null;
  /** Source attachment; shared across annotations from the same attachment. */
  parentAttachment: TemplateAttachment;
}

/**
 * The `zt` root of the `annotation` template: a {@link TemplateAnnotation} plus
 * {@link AnnotationTemplateContext.citation}. Entries of `zt.annotations` on the
 * note root are plain {@link TemplateAnnotation}s — only the single-annotation
 * render carries a citation.
 */
export interface AnnotationTemplateContext extends TemplateAnnotation {
  /**
   * Page-pinned citation of {@link TemplateAnnotation.parentItem}, rendered
   * through the `cite` template with this annotation's
   * {@link TemplateAnnotationBaseData.pageLabel} as locator; `null` when there
   * is no parent item or it carries no citation key. Computed at the app layer.
   */
  citation: string | null;
}

/**
 * Attach {@link AnnotationTemplateContext.citation} to an annotation's template
 * data, promoting it to the annotation root.
 *
 * @param renderCitation - Called lazily, only when a template reads
 *   `zt.citation`, so the `cite` render is skipped otherwise.
 * @returns `data` itself, redeclared as the annotation root.
 */
export function withAnnotationCitation(
  data: TemplateAnnotation,
  renderCitation: (this: void) => string | null,
): AnnotationTemplateContext {
  return Object.defineProperty(data, "citation", {
    enumerable: true,
    get: renderCitation,
  }) as AnnotationTemplateContext;
}

/**
 * Map a DB {@link Annotation} to its template shape. App-layer fields
 * (`imgLink`, `comment`, `fileLink`, `backlink`) and parent references are
 * omitted — they are filled by the Obsidian-side note-create flow.
 */
function annotationToTemplateBaseData(
  annotation: Annotation,
  tags: readonly ItemTag[],
): TemplateAnnotationBaseData {
  const pageIndex = annotation.position.pageIndex;
  return {
    key: annotation.key,
    indexedKey: annotation.indexedKey,
    libraryID: annotation.libraryID,
    type: annotationTypeToName(annotation.type),
    text: emptyToNull(annotation.text),
    commentHtml: emptyToNull(annotation.comment),
    colorHex: annotation.color,
    colorName: annotationColorToName(annotation.color),
    pageLabel: emptyToNull(annotation.pageLabel),
    page: typeof pageIndex === "number" ? pageIndex + 1 : null,
    authorName: emptyToNull(annotation.authorName),
    isExternal: annotation.isExternal,
    dateAdded: annotation.dateAdded,
    dateModified: annotation.dateModified,
    tags: tags.map(toTemplateTag),
  };
}

export interface AnnotationTemplateDataInput {
  annotation: Annotation;
  tags: readonly ItemTag[];
  getParentAttachment(this: void): TemplateAttachment;
  getParentItem(this: void): TemplateParentItemData | null;
  /**
   * Convert an annotation's raw comment HTML to Markdown. Called lazily, only
   * when a template reads `zt.comment`, so the conversion is skipped otherwise.
   */
  commentToMarkdown: (html: string) => string;
  /**
   * Build an annotation's excerpt-image link helper, or `null` when the
   * annotation type has no cached image. Prefix `!` to the rendered link for an
   * embed.
   */
  annotationImageLink: (annotation: Annotation) => TemplateLink | null;
  /**
   * Build an attachment's file-link helper. Pass a 1-based `page` to default the
   * helper's subpath to `#page=N` (annotation-level links anchor to their page);
   * the helper returns `null` when the file is unresolvable.
   */
  fileLink: (page?: number | null) => FallibleTemplateLink;
}

export function annotationToTemplateData({
  annotation,
  tags,
  getParentAttachment,
  getParentItem,
  annotationImageLink,
  commentToMarkdown,
  fileLink,
}: AnnotationTemplateDataInput): TemplateAnnotation {
  let comment: string | null | undefined;
  const baseData = annotationToTemplateBaseData(annotation, tags);
  // Previews by excerpt text, falling back to the raw comment then the type
  // name — so `zt.annotations` items read as content, not a bare index. Uses
  // `commentHtml` (not the lazy `comment` getter) to avoid triggering Markdown
  // conversion on every stringify.
  return defineToString(
    {
      ...baseData,
      get backlink() {
        return annotationOpenUri({
          attachmentKey: getParentAttachment().key,
          annotationKey: annotation.key,
          pageLabel: annotation.pageLabel,
          groupID: annotation.groupID,
        });
      },
      imgLink: annotationImageLink(annotation),
      get comment() {
        if (comment === undefined) {
          comment = baseData.commentHtml
            ? emptyToNull(commentToMarkdown(baseData.commentHtml))
            : null;
        }
        return comment ?? null;
      },
      fileLink: fileLink(baseData.page),
      get parentItem() {
        return getParentItem();
      },
      get parentAttachment() {
        return getParentAttachment();
      },
    },
    function () {
      return this.text ?? this.commentHtml ?? this.type;
    },
  );
}
