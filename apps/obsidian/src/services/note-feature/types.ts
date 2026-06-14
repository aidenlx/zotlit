import {
  type TemplateAnnotation,
  type TemplateAttachment,
  type TemplateCreator,
  type TemplateItemData,
} from "@zotlit/db";

/**
 * The `zt` root for the `note` template: {@link TemplateItemData} plus the
 * runtime-computed fields assembled at the app layer (backlinks, resolved
 * attachment links, flattened annotations/tags, author conveniences).
 */
export interface NoteTemplateContext extends TemplateItemData {
  /** Zotero deep link to the literature item (`zotero://select/...`). */
  backlink: string;
  /** Flat annotation list across all (or scoped) attachments. */
  annotations: TemplateAnnotation[];
  /** All attachments for the item. */
  attachments: TemplateAttachment[];
  /** Flat tag names. */
  tags: string[];
  /** Creators filtered to {@link TemplateItemData.primaryCreatorType}. */
  authors: TemplateCreator[];
  /** Formatted short author string, e.g. `"Smith et al."`. */
  authorsShort: string;
}

/** A user-configured frontmatter entry: `key` mapped to a JS `expr` over `zt`. */
export interface FrontmatterField {
  key: string;
  expr: string;
}
