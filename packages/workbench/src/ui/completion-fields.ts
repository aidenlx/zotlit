import type { WorkbenchMessages } from "./generated/messages";
import type { WorkbenchMessageLabel } from "./messages";
import type { TemplateRoot } from "./store";

export interface CommonField {
  /** Top-level key on the root object, which is also its display-node key. */
  readonly key: string;
  /** The name the reader recognizes, in place of the raw key. */
  readonly label: WorkbenchMessageLabel;
}

/**
 * Familiar labels and preferred order for common fields in each root.
 */
export const COMMON_FIELDS: Record<TemplateRoot, readonly CommonField[]> = {
  note: [
    { key: "title", label: "workbench_field_title" },
    { key: "authors", label: "workbench_field_authors" },
    { key: "date", label: "workbench_field_date" },
    { key: "abstract", label: "workbench_field_abstract" },
    { key: "publicationTitle", label: "workbench_field_publication_title" },
    { key: "citationKey", label: "workbench_field_citation_key" },
    { key: "tags", label: "workbench_field_tags" },
    { key: "collections", label: "workbench_field_collections" },
    { key: "backlink", label: "workbench_field_backlink" },
    { key: "attachments", label: "workbench_field_attachments" },
    { key: "annotations", label: "workbench_field_annotations" },
  ],
  annotation: [
    { key: "text", label: "workbench_field_text" },
    { key: "comment", label: "workbench_field_comment" },
    { key: "pageLabel", label: "workbench_field_page_label" },
    { key: "colorName", label: "workbench_field_color_name" },
    { key: "tags", label: "workbench_field_tags" },
    { key: "backlink", label: "workbench_field_backlink" },
    { key: "imgLink", label: "workbench_field_img_link" },
    { key: "parentItem", label: "workbench_field_parent_item" },
  ],
  filename: [
    { key: "title", label: "workbench_field_title" },
    { key: "authors", label: "workbench_field_authors" },
    { key: "date", label: "workbench_field_date" },
    { key: "citationKey", label: "workbench_field_citation_key" },
    { key: "key", label: "workbench_field_key" },
  ],
  citation: [
    { key: "variant", label: "workbench_field_variant" },
    { key: "citations", label: "workbench_field_citations" },
    { key: "items", label: "workbench_field_items" },
  ],
};

/** Human labels and common-field order shared by discovery and typing completion. */
export function completionFields(m: WorkbenchMessages, root: TemplateRoot) {
  return COMMON_FIELDS[root].map((field) => ({
    path: `zt.${field.key}`,
    label: m[field.label](),
  }));
}
