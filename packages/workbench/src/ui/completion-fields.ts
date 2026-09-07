import { m } from "./paraglide/messages.js";
import type { TemplateRoot } from "./store";

export interface CommonField {
  /** Top-level key on the root object, which is also its display-node key. */
  readonly key: string;
  /** The name the reader recognizes, in place of the raw key. */
  readonly label: () => string;
}

/**
 * Familiar labels and preferred order for common fields in each root.
 */
export const COMMON_FIELDS: Record<TemplateRoot, readonly CommonField[]> = {
  note: [
    { key: "title", label: m.workbench_field_title },
    { key: "authors", label: m.workbench_field_authors },
    { key: "date", label: m.workbench_field_date },
    { key: "abstract", label: m.workbench_field_abstract },
    { key: "publicationTitle", label: m.workbench_field_publication_title },
    { key: "citationKey", label: m.workbench_field_citation_key },
    { key: "tags", label: m.workbench_field_tags },
    { key: "collections", label: m.workbench_field_collections },
    { key: "backlink", label: m.workbench_field_backlink },
    { key: "attachments", label: m.workbench_field_attachments },
    { key: "annotations", label: m.workbench_field_annotations },
  ],
  annotation: [
    { key: "text", label: m.workbench_field_text },
    { key: "comment", label: m.workbench_field_comment },
    { key: "pageLabel", label: m.workbench_field_page_label },
    { key: "colorName", label: m.workbench_field_color_name },
    { key: "tags", label: m.workbench_field_tags },
    { key: "backlink", label: m.workbench_field_backlink },
    { key: "imgLink", label: m.workbench_field_img_link },
    { key: "parentItem", label: m.workbench_field_parent_item },
  ],
  filename: [
    { key: "title", label: m.workbench_field_title },
    { key: "authors", label: m.workbench_field_authors },
    { key: "date", label: m.workbench_field_date },
    { key: "citationKey", label: m.workbench_field_citation_key },
    { key: "key", label: m.workbench_field_key },
  ],
};

/** Human labels and common-field order shared by discovery and typing completion. */
export function completionFields(root: TemplateRoot) {
  return COMMON_FIELDS[root].map((field) => ({
    path: `zt.${field.key}`,
    label: field.label(),
  }));
}
