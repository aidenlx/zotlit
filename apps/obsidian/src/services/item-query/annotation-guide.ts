// Annotation-specific text in the ZotLit Query guide. Query commands and
// Filter Expressions shown here are collected so tests run them against a
// real source.

import {
  QUERY_COMMAND,
  QUERY_CANCEL_COMMAND,
  QUERY_ID_FORM,
  queryCancelledText,
} from "./contract";

const ANNOTATION_IMAGE_COMMAND = "zotlit:annotation-image";

/** One Annotation Query example from the guide, as flat CLI arguments. */
export type AnnotationGuideExample = Readonly<Record<string, string>>;

const examples: AnnotationGuideExample[] = [];
const filters: string[] = [];

/** Every Annotation Query example that the guide shows. */
export const ANNOTATION_GUIDE_EXAMPLES: readonly AnnotationGuideExample[] =
  examples;
/** Every Annotation Filter Expression the guide shows outside a command. */
export const ANNOTATION_GUIDE_FILTERS: readonly string[] = filters;

function example(args: AnnotationGuideExample): string {
  const params = { from: "annotations", ...args };
  examples.push(params);
  const parts = Object.entries(params).map(([name, value]) =>
    /^[\w:-]+$/.test(value) ? `${name}=${value}` : `${name}='${value}'`,
  );
  return [`obsidian ${QUERY_COMMAND}`, ...parts].join(" ");
}

function filter(expression: string): string {
  filters.push(expression);
  return expression;
}

const FILTER_SECTION = `ANNOTATION FILTERS

FIELDS
  An Annotation filter uses bare names for its own fields. The schema catalog
  lists every field, function, method, and property.
    ${filter('type == "highlight"')}
    ${filter('colorName == "yellow"')}
    ${filter('tags.contains("method")')}

PARENT RECORDS
  Prefix an Item field or Projection Path with item. Prefix an Attachment
  field or Projection Path with attachment. Both parents are always present.
  Annotation and Item conditions can be in one expression:
    ${filter('type == "image" && item.title.contains("Exact")')}
    ${example({ filter: 'type == "highlight" && item.title.contains("Exact")', fields: "text,item.title", limit: "20" })}`;

const KEYS_SECTION = `ITEM, ATTACHMENT, AND ANNOTATION KEYS

SELECT PARENTS
  Select with item.indexedKey or attachment.indexedKey in the filter.
  Use indexedKey for the Annotation itself, and && to combine conditions.
  A literal list selects several keys with .contains(item.indexedKey).
  Set library to include each key's Library; a key outside the Target Libraries
  gives a Query Warning and leaves the Target Libraries unchanged.
    ${example({ filter: 'item.indexedKey == "ART2FULL"', limit: "all" })}
    ${example({ filter: 'attachment.indexedKey == "PDF2LIVE"', fields: "text,pageLabel", limit: "all" })}

RESULT IDENTITIES
  Every row has indexedKey for the Annotation, attachmentIndexedKey for its
  Attachment, and itemIndexedKey for its parent Item. Personal-library keys are
  bare Zotero keys. A group-library key ends with g and the group ID.`;

const FIELDS_SECTION = `FIELDS AND POSITION

PROJECTION PATHS
  fields='[]' returns only the three row identities. position is available
  only when requested and stays out of the default row.
    ${example({ filter: 'attachment.indexedKey == "PDF2LIVE"', fields: "position", limit: "all" })}

POSITION KINDS
  position.kind is pdf-rects, pdf-ink, pdf-text, epub-cfi, snapshot-css,
  snapshot-text, or unknown. unknown carries the stored JSON in raw. PDF x and
  y coordinates are PDF points from the bottom-left origin. The row's
  pageIndex is a zero-based PDF page index and is null for EPUB and snapshot
  Annotations. pageLabel is the document's own page or location label.

ATTACHMENT FILE
  Projecting attachment returns its fixed Attachment summary. path is absolute
  when the file can be resolved on this device; exists states whether that
  path exists at query time.`;

const SORT_SECTION = `ANNOTATION ORDER

  The schema catalog marks Sortable Fields. Missing values come last. The
  Sort Index and then the Annotation Indexed Key resolve ties after the
  requested sort fields.
    ${example({ sort: "pageIndex", limit: "all" })}
  truncated is true when more Annotations match the request than it returns.`;

const IMAGES_SECTION = `EXCERPT IMAGES

WHEN TO REQUEST ONE
  hasExcerptImage is true for image and ink Annotations. Read indexedKey from
  that row, then run ${ANNOTATION_IMAGE_COMMAND} with key=<indexed-key>.
  The answer gives a local PNG path and provenance. Read the file at that path.
  EPUB and snapshot Annotations have no Excerpt Image in this command.

FAILURES
  annotation-not-found means the key is absent. not-an-image-annotation means
  the Annotation has no Excerpt Image. file-unavailable means Zotero has no
  cached image and the source PDF is unavailable on this device.`;

const CANCEL_SECTION = `ANNOTATION CANCEL EXAMPLE

  id names one running ZotLit Query in this vault. It has ${QUERY_ID_FORM}.
  A second running query with that id fails with query-id-in-use.
    ${example({ id: "annotations-1", limit: "all", fields: "[]" })}

  In another terminal, run:
    obsidian ${QUERY_CANCEL_COMMAND} id=annotations-1
  cancelRequested is true when that call found the running query. The cancelled
  query prints: Error: ${queryCancelledText("annotations-1")}
  A completed or unknown id returns cancelRequested false.`;

/** Annotation material folded into the shared guide's topics. */
export const ANNOTATION_GUIDE_SECTIONS = {
  filter: `${FILTER_SECTION}\n\n${KEYS_SECTION}`,
  fields: `${FIELDS_SECTION}\n\n${IMAGES_SECTION}`,
  sort: SORT_SECTION,
  cancel: CANCEL_SECTION,
};
