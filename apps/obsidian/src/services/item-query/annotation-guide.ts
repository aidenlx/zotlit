// The Annotation Query guide. Query commands and Filter Expressions shown by
// this file are collected below, so tests run them against a real source.

import {
  QUERY_COMMAND,
  QUERY_CANCEL_COMMAND,
  QUERY_ID_FORM,
  queryCancelledText,
} from "./contract";

const ANNOTATION_IMAGE_COMMAND = "zotlit:annotation-image";

/** One Annotation Query command from the guide, as flat CLI arguments. */
export type AnnotationGuideExample = Readonly<Record<string, string>>;

const examples: AnnotationGuideExample[] = [];
const filters: string[] = [];

/** Every Annotation Query command the guide shows. */
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

const FILTER_SECTION = `FILTER AND PARENT ITEM FIELDS

DESCRIPTION
  filter selects Annotations. Join conditions with &&, ||, and !, and group
  them with parentheses. Text matches exactly unless a helper changes it.
  The schema catalog lists every field, function, method, and property.
    ${filter('type == "highlight"')}
    ${filter('colorName == "yellow"')}
    ${filter('tags.contains("method")')}

PARENT ITEM FIELDS
  Prefix an Item Query field or Projection Path with item. The parent Item is
  always present. Annotation and Item conditions can be in one expression:
    ${filter('type == "image" && item.title.contains("Exact")')}
    ${example({ filter: 'type == "highlight" && item.title.contains("Exact")', fields: "text,item.title", limit: "20" })}`;

const KEYS_SECTION = `ITEM, ATTACHMENT, AND ANNOTATION KEYS

SELECT PARENTS
  item and attachment take one Indexed Key or a JSON array of Indexed Keys.
  Each selector chooses its own Library. When both are present, an Annotation
  must belong to both selections. A selector and filter also combine with AND.
    ${example({ item: "ART2FULL", limit: "all" })}
    ${example({ attachment: "PDF2LIVE", fields: "text,pageLabel", limit: "all" })}

RESULT IDENTITIES
  Every row has indexedKey for the Annotation, attachmentIndexedKey for its
  Attachment, and itemIndexedKey for its parent Item. Personal-library keys are
  bare Zotero keys. A group-library key ends with g and the group ID.`;

const FIELDS_SECTION = `FIELDS AND POSITION

PROJECTION PATHS
  fields is a comma list or JSON array of values to return. fields='[]' returns only the
  three row identities. position is available only when requested and stays
  out of the default row.
    ${example({ attachment: "PDF2LIVE", fields: "position", limit: "all" })}

POSITION KINDS
  position.kind is pdf-rects, pdf-ink, pdf-text, epub-cfi, snapshot-css,
  snapshot-text, or unknown. unknown carries the stored JSON in raw. PDF x and
  y coordinates are PDF points from the bottom-left origin. The row's
  pageIndex is a zero-based PDF page index and is null for EPUB and snapshot
  Annotations. pageLabel is the document's own page or location label.

ATTACHMENT FILE
  attachment has indexedKey, title, contentType, linkMode, path, and exists.
  path is absolute when the file can be resolved on this device; exists states
  whether that path exists at query time.`;

const SORT_SECTION = `SORT AND LIMIT

SORT
  sort takes -field for descending order, or field for ascending order.
  A JSON array of {"field","direction"} is also accepted.
  The schema catalog marks Sortable Fields. Missing values come last. The
  Sort Index and then the Annotation Indexed Key resolve ties.
    ${example({ sort: "pageIndex", limit: "all" })}

LIMIT
  limit is a positive integer, or all. All Target Libraries are sorted and
  limited as one result set. truncated is true when more Annotations match.`;

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

const CANCEL_SECTION = `CANCEL A RUNNING QUERY

NAME THE QUERY
  id names one running Item Query or Annotation Query in this vault. It has
  ${QUERY_ID_FORM}. A second running query with that id fails with
  query-id-in-use.
    ${example({ id: "annotations-1", limit: "all", fields: "[]" })}

CANCEL
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
