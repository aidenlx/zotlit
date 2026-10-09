// The Annotation Query guide. Query commands and Filter Expressions shown by
// this file are collected below, so tests run them against a real source.

import { ANNOTATIONS } from "@zotlit/item-query";

import {
  ANNOTATION_QUERY_COMMAND,
  ANNOTATION_QUERY_GUIDE_COMMAND,
  ANNOTATION_QUERY_SCHEMA_COMMAND,
  DEFAULT_CLI_LIMIT,
  ITEM_QUERY_CANCEL_COMMAND,
  INLINE_MAX_BYTES,
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
  examples.push(args);
  const parts = Object.entries(args).map(([name, value]) =>
    /^[\w:-]+$/.test(value) ? `${name}=${value}` : `${name}='${value}'`,
  );
  return [`obsidian ${ANNOTATION_QUERY_COMMAND}`, ...parts].join(" ");
}

function filter(expression: string): string {
  filters.push(expression);
  return expression;
}

function listOf(names: readonly string[]): string {
  return new Intl.ListFormat("en", { type: "conjunction" }).format(names);
}

const DEFAULT_FIELD_LIST = listOf(ANNOTATIONS.defaultFields);
const DEFAULT_SORT_TEXT = listOf(
  ANNOTATIONS.defaultSort.map(
    ({ field, direction }) =>
      `${field} ${direction === "desc" ? "descending" : "ascending"}`,
  ),
);

const COMMAND_SECTION = `COMMAND FORM AND DEFAULTS

SYNOPSIS
  obsidian ${ANNOTATION_QUERY_COMMAND} [filter=<expression>] [item=<key|json>]
    [attachment=<key|json>] [fields=<json>] [sort=<json>] [limit=<n|all>]
    [library=<personal|group:id>] [libraries=<json|all>]
    [output=<absolute-path>] [id=<id>]
  obsidian ${ANNOTATION_QUERY_SCHEMA_COMMAND}
  obsidian ${ANNOTATION_QUERY_GUIDE_COMMAND} [topic=<name>]

DEFAULTS
  Without arguments, the query reads the Libraries in ZotLit's Library scope
  setting and returns at most ${DEFAULT_CLI_LIMIT} rows. Each row has
  ${DEFAULT_FIELD_LIST}. The default order is ${DEFAULT_SORT_TEXT}.
    ${example({ library: "personal", limit: "5" })}

LIBRARIES
  library names one Library: personal, or group:<groupID>. libraries names a
  JSON array of Libraries, or all. libraries wins when both are present.
  An item or attachment key selects its Library, so do not add library or
  libraries beside either key.`;

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
    ${example({ filter: 'type == "highlight" && item.title.contains("Exact")', fields: '["text","item.title"]', limit: "20" })}`;

const KEYS_SECTION = `ITEM, ATTACHMENT, AND ANNOTATION KEYS

SELECT PARENTS
  item and attachment take one Indexed Key or a JSON array of Indexed Keys.
  Each selector chooses its own Library. When both are present, an Annotation
  must belong to both selections. A selector and filter also combine with AND.
    ${example({ item: "ART2FULL", limit: "all" })}
    ${example({ attachment: "PDF2LIVE", fields: '["text","pageLabel"]', limit: "all" })}

RESULT IDENTITIES
  Every row has indexedKey for the Annotation, attachmentIndexedKey for its
  Attachment, and itemIndexedKey for its parent Item. Personal-library keys are
  bare Zotero keys. A group-library key ends with g and the group ID.`;

const FIELDS_SECTION = `FIELDS AND POSITION

PROJECTION PATHS
  library is personal for My Library or group:<groupID> for a group.
  fields is a JSON array of values to return. fields='[]' returns only the
  three row identities. position is available only when requested and stays
  out of the default row.
    ${example({ attachment: "PDF2LIVE", fields: '["position"]', limit: "all" })}

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
  sort is a JSON array of {"field","direction"}; direction is asc or desc.
  The schema catalog marks Sortable Fields. Missing values come last. The
  Sort Index and then the Annotation Indexed Key resolve ties.
    ${example({ sort: '[{"field":"pageIndex","direction":"asc"}]', limit: "all" })}

LIMIT
  limit is a positive integer, or all. All Target Libraries are sorted and
  limited as one result set. truncated is true when more Annotations match.`;

const RESULTS_SECTION = `RESULTS AND DIAGNOSTICS

ENVELOPE
  Contract version 2 uses the shared Query envelope. A successful answer has
  identity, libraries, request, returnedCount, truncated, warnings, and rows.
  warnings is always present before rows, including an empty result or export.
  Read warnings before reporting an empty result. A definite comparison of
  different types can be never-true or always-true; its rows still reflect
  the expression as written.

  On failure, read diagnostic.report first. Its lines show the fault, excerpt,
  and recovery action. The diagnostic also has code, message, hint, severity,
  found, expected, and suggestions. excerpt contains before, at, and after;
  location names the argument and may give a JSON path or UTF-16 span.
  diagnostic.hint repeats the recovery action. Follow the report and run
  the corrected query.

FILE EXPORT
  An inline answer is limited to ${INLINE_MAX_BYTES} UTF-8 bytes. Add
  output=<absolute-path> to write the complete JSON envelope to a new file.
  The response then has file.path, file.bytes, and file.format instead of rows.`;

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
    obsidian ${ITEM_QUERY_CANCEL_COMMAND} id=annotations-1
  cancelRequested is true when that call found the running query. The cancelled
  query prints: Error: ${queryCancelledText("annotations-1")}
  A completed or unknown id returns cancelRequested false.`;

export const ANNOTATION_GUIDE_TOPICS = {
  command: COMMAND_SECTION,
  filter: FILTER_SECTION,
  keys: KEYS_SECTION,
  fields: FIELDS_SECTION,
  sort: SORT_SECTION,
  results: RESULTS_SECTION,
  images: IMAGES_SECTION,
  cancel: CANCEL_SECTION,
} as const satisfies Record<string, string>;

export type AnnotationGuideTopic = keyof typeof ANNOTATION_GUIDE_TOPICS;
export const ANNOTATION_GUIDE_TOPIC_NAMES = Object.keys(
  ANNOTATION_GUIDE_TOPICS,
) as readonly AnnotationGuideTopic[];

export function parseAnnotationGuideTopic(
  value: string,
): AnnotationGuideTopic | null {
  return Object.hasOwn(ANNOTATION_GUIDE_TOPICS, value)
    ? (value as AnnotationGuideTopic)
    : null;
}

const QUICKSTART = `ZOTLIT ANNOTATION QUERY

Annotation Query finds the marks and notes made while reading Zotero
Attachments and returns the selected values as JSON. It reads Annotations
outside the trash and changes nothing in Zotero.

WORKFLOW
  1. Read topic=command for the command form and defaults.
  2. Use item or attachment for one document, or filter across Libraries.
  3. Choose fields. Add position only when the task needs source geometry.
  4. On ok false, read diagnostic.report and correct the query. Read warnings
     before reporting an empty result.

EXAMPLE
  ${example({ item: "ART2FULL", fields: '["text","comment","pageLabel","item.title"]', limit: "all" })}

TOPICS
  ${ANNOTATION_GUIDE_TOPIC_NAMES.join(", ")}
  Read one topic with obsidian ${ANNOTATION_QUERY_GUIDE_COMMAND} topic=<name>.

SEE ALSO
  obsidian help ${ANNOTATION_QUERY_COMMAND}`;

export function renderAnnotationGuide(
  topic: AnnotationGuideTopic | null,
): string {
  return topic === null ? QUICKSTART : ANNOTATION_GUIDE_TOPICS[topic];
}
