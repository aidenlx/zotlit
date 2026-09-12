// The names a host shows for the Citation Template preview's own two choices:
// which built-in example set it renders, and which Citation Variant.

import type { CitationExampleId } from "#/render/citation-examples";

import type { CitationVariant } from "@zotlit/db";

import type { WorkbenchMessages } from "./generated/messages";
import type { WorkbenchMessageLabel } from "./messages";

const EXAMPLE_LABEL: Record<CitationExampleId, WorkbenchMessageLabel> = {
  "one-item": "workbench_citation_example_one_item",
  "two-items": "workbench_citation_example_two_items",
  "item-with-page": "workbench_citation_example_item_with_page",
  "suppressed-author": "workbench_citation_example_suppressed_author",
  "prefix-and-suffix": "workbench_citation_example_prefix_and_suffix",
  "annotation-citation": "workbench_citation_example_annotation_citation",
};

const VARIANT_LABEL: Record<CitationVariant, WorkbenchMessageLabel> = {
  main: "workbench_citation_variant_main",
  alt: "workbench_citation_variant_alt",
};

/** The name one built-in Citation example set is chosen and captioned by. */
export function citationExampleLabel(
  m: WorkbenchMessages,
  id: CitationExampleId,
): string {
  return m[EXAMPLE_LABEL[id]]();
}

/** The Citation Variant as the short noun a caption names it with. */
export function citationVariantLabel(
  m: WorkbenchMessages,
  variant: CitationVariant,
): string {
  return m[VARIANT_LABEL[variant]]();
}
