import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import type { Attachment } from "@zotlit/db";
import {
  readAnnotationHydrateChunk,
  readAnnotationScanPage,
  readAnnotationUniverseRows,
  readFieldVocabulary,
} from "@zotlit/db/item-query";
import type { AnnotationScanRow } from "@zotlit/db/item-query";

import {
  annotationFieldDefinition,
  DEFAULT_ANNOTATION_FIELDS,
} from "./annotation-fields";
import type { QueryAnnotation } from "./annotation-fields";
import { ItemQueryError } from "./error";
import { consumeDataset } from "./execution";
import { planPath, readPath } from "./projection";
import type { PlannedPath } from "./projection";
import type { QueryConsumer, QuerySummary } from "./query-items";
import { planRequest } from "./request";
import type { ItemQueryRequest, QueryRow, SortSpec } from "./request";

export interface AnnotationQueryRequest extends ItemQueryRequest {
  readonly item?: readonly string[];
  readonly attachment?: readonly string[];
}

export interface AnnotationQueryOptions {
  readonly resolveAttachmentFile?: (attachment: Attachment) => Effect.Effect<{
    readonly path: string | null;
    readonly exists: boolean;
  }>;
}

export const DEFAULT_ANNOTATION_SORT: readonly SortSpec[] = [
  { field: "item.dateModified", direction: "desc" },
  { field: "attachment.indexedKey", direction: "asc" },
  { field: "sortIndex", direction: "asc" },
];

export const queryAnnotations = (
  request: AnnotationQueryRequest,
  options: AnnotationQueryOptions = {},
) =>
  consumeQueryAnnotations(
    request,
    (summary) =>
      Effect.sync(() => {
        const rows: QueryRow[] = [];
        return {
          write: (chunk: readonly QueryRow[]) =>
            Effect.sync(() => {
              rows.push(...chunk);
            }),
          end: () => Effect.succeed({ ...summary, rows }),
        };
      }),
    options,
  );

/** Annotation dataset on the same bounded execution and projection path as Item Query. */
export function consumeQueryAnnotations<A, E, R>(
  request: AnnotationQueryRequest,
  begin: (summary: QuerySummary) => Effect.Effect<QueryConsumer<A, E, R>, E, R>,
  options: AnnotationQueryOptions = {},
) {
  return Effect.gen(function* () {
    // Common Library and limit validation runs before any reader.
    const base = yield* planRequest({
      ...request,
      filter: undefined,
      fields: [],
      sort: [],
    });
    if (request.filter !== undefined)
      return yield* new ItemQueryError({
        code: "invalid-filter",
        location: { argument: "filter" },
        message: "The Annotation Filter Expression is not supported.",
        hint: "Select an Item with item.",
      });
    const fields = request.fields ?? DEFAULT_ANNOTATION_FIELDS;
    const paths: PlannedPath<QueryAnnotation>[] = [];
    for (const [index, text] of fields.entries()) {
      const parent = text.startsWith("item.");
      const path = parent
        ? planPath(text.slice(5), (name) =>
            annotationFieldDefinition(`item.${name}`),
          )
        : planPath(text, annotationFieldDefinition);
      if ("code" in path)
        return yield* new ItemQueryError({
          ...path,
          location: { argument: "fields", index },
          hint: "Use an Annotation Query Projection Path.",
        });
      paths.push({ ...path, text });
    }
    if (request.sort !== undefined && request.sort.length > 0)
      return yield* new ItemQueryError({
        code: "unsortable-field",
        location: { argument: "sort", index: 0 },
        message: "The requested Annotation sort is not supported.",
        hint: "Omit sort to use reading order.",
      });
    const vocabulary = yield* readFieldVocabulary();
    const query = {
      ...base.query,
      ...(request.item ? { item: request.item } : {}),
      ...(request.attachment ? { attachment: request.attachment } : {}),
      fields: [...fields],
      sort: request.sort ?? DEFAULT_ANNOTATION_SORT,
    };
    const load = (projection: boolean) =>
      Effect.fnUntraced(function* (chunk: readonly AnnotationScanRow[]) {
        const hydrated = yield* readAnnotationHydrateChunk({
          rows: chunk,
          vocabulary,
          fields: { builtIn: ["title", "citationKey"], custom: [] },
        });
        const result: QueryAnnotation[] = [];
        for (const scan of chunk) {
          const annotation = hydrated.get(scan.itemID)!;
          const groupID = request.libraries.find(
            (library) => library.libraryID === annotation.attachment.libraryID,
          )!.groupID;
          const file =
            projection &&
            options.resolveAttachmentFile &&
            paths.some(
              (path) =>
                path.text === "attachment" ||
                path.text.startsWith("attachment."),
            )
              ? yield* options.resolveAttachmentFile({
                  ...annotation.attachment,
                  groupID,
                  indexedKey: formatIndexedKey(scan.attachmentKey, groupID),
                })
              : { path: null, exists: false };
          result.push({
            scan,
            annotation,
            groupID,
            file,
            parent: {
              scan: scan.parent,
              hydrated: annotation.parent,
              customFieldNames: vocabulary.customFieldNames,
            },
          });
        }
        return result;
      });
    return yield* consumeDataset(
      {
        query,
        libraries: request.libraries,
        sort: query.sort,
        scan: { plan: true, load: load(false) },
        projection: { plan: true, load: load(true) },
        readScanPage: readAnnotationScanPage,
        readUniverseRows: readAnnotationUniverseRows,
        candidates: () => Effect.succeed(null),
        matches: (item) =>
          (!request.item ||
            request.item.includes(
              formatIndexedKey(item.scan.parent.key, item.groupID),
            )) &&
          (!request.attachment ||
            request.attachment.includes(
              formatIndexedKey(item.scan.attachmentKey, item.groupID),
            )),
        keys: (item) =>
          request.sort?.length === 0
            ? []
            : [
                item.scan.parent.dateModified,
                item.scan.attachmentKey,
                item.scan.sortIndex,
              ],
        project: (item, library, scan) => ({
          indexedKey: formatIndexedKey(scan.key, library.groupID),
          attachmentIndexedKey: formatIndexedKey(
            scan.attachmentKey,
            library.groupID,
          ),
          itemIndexedKey: formatIndexedKey(scan.parent.key, library.groupID),
          values: Object.fromEntries(
            paths.map((path) => [path.text, readPath(path, item)]),
          ),
        }),
      },
      begin,
    );
  });
}
