import { Effect } from "effect";

import { formatIndexedKey, parseIndexedKey } from "@zotlit/db";
import type { Attachment } from "@zotlit/db";
import {
  readAnnotationHydrateChunk,
  readAnnotationRowCount,
  readAnnotationCandidateSet,
  readAnnotationScanPage,
  readAnnotationUniverseRows,
  readFieldVocabulary,
} from "@zotlit/db/item-query";
import type { AnnotationScanRow } from "@zotlit/db/item-query";
import type { AnnotationCandidateLeaf } from "@zotlit/db/item-query";

import { lowerAnnotationCandidate } from "./annotation-candidates";
import {
  annotationFieldDefinition,
  DEFAULT_ANNOTATION_FIELDS,
  ANNOTATION_SORT_FIELDS,
  planAnnotationFilter,
} from "./annotation-fields";
import type { QueryAnnotation } from "./annotation-fields";
import { planCandidates, readCandidatePlan } from "./candidate-plan";
import type { CandidatePlan } from "./candidate-plan";
import { diagnoseWarning } from "./diagnose";
import { ItemQueryError } from "./error";
import { consumeDataset } from "./execution";
import type { FieldDefinition, FieldNeeds } from "./fields";
import { matches as isMatch } from "./filter-evaluate";
import { openHydration } from "./hydration";
import { planPath, readPath } from "./projection";
import type { PlannedPath } from "./projection";
import { readQueryClock } from "./query-clock";
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
    const plannedFilter =
      request.filter === undefined
        ? null
        : planAnnotationFilter(request.filter);
    if (plannedFilter && "kind" in plannedFilter)
      return yield* new ItemQueryError({
        fault: plannedFilter,
        location: {
          argument: "filter",
          span:
            plannedFilter.kind === "syntax"
              ? { from: plannedFilter.fault.from, to: plannedFilter.fault.to }
              : plannedFilter.at,
        },
      });
    const filter = plannedFilter;
    const clock = yield* readQueryClock;
    const fields = request.fields ?? DEFAULT_ANNOTATION_FIELDS;
    const paths: PlannedPath<QueryAnnotation>[] = [];
    for (const [index, text] of fields.entries()) {
      const parent = text.startsWith("item.");
      const path = parent
        ? planPath(text.slice(5), (name) =>
            annotationFieldDefinition(`item.${name}`),
          )
        : planPath(text, annotationFieldDefinition);
      if ("kind" in path)
        return yield* new ItemQueryError({
          fault:
            path.kind === "unknown"
              ? { ...path, name: text, at: { from: 0, to: text.length } }
              : path,
          location: { argument: "fields", index, path: `fields[${index}]` },
          argumentText: JSON.stringify(fields),
        });
      paths.push({ ...path, text });
    }
    const sorts: {
      needs: FieldNeeds;
      key: NonNullable<FieldDefinition<QueryAnnotation>["sortKey"]>;
    }[] = [];
    for (const [index, sort] of (request.sort ?? []).entries()) {
      const definition = annotationFieldDefinition(sort.field);
      if (!ANNOTATION_SORT_FIELDS.has(sort.field) || !definition?.sortKey)
        return yield* new ItemQueryError({
          fault: {
            kind: "unknown",
            role: "sortable-field",
            name: sort.field,
            at: { from: 0, to: sort.field.length },
          },
          location: { argument: "sort", index, path: `sort[${index}].field` },
          argumentText: JSON.stringify(request.sort),
        });
      sorts.push({ needs: definition.needs([]), key: definition.sortKey });
    }
    const hydration = yield* openHydration(
      { filter, paths, sorts },
      request.libraries,
    );
    const vocabulary = yield* readFieldVocabulary();
    const query = {
      ...base.query,
      filter: request.filter ?? null,
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
          fields: { builtIn: [], custom: [] },
        });
        const parents = new Map(
          (yield* (projection ? hydration.projection : hydration.scan).load([
            ...new Map(
              chunk.map((row) => [row.parent.itemID, row.parent]),
            ).values(),
          ])).map((parent) => [parent.scan.itemID, parent]),
        );
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
            parent: parents.get(scan.parent.itemID)!,
          });
        }
        return result;
      });
    return yield* consumeDataset(
      {
        query,
        warnings: (filter?.warnings ?? []).map((fault) =>
          diagnoseWarning(fault, query.filter!, {
            clock,
            dataset: "annotations",
          }),
        ),
        libraries: request.libraries,
        sort: [...query.sort, { field: "sortIndex", direction: "asc" }],
        scan: { plan: true, load: load(false) },
        projection: { plan: true, load: load(true) },
        readScanPage: readAnnotationScanPage,
        readUniverseRows: readAnnotationUniverseRows,
        candidates: (library, tuning) =>
          Effect.gen(function* () {
            if (tuning.forceScan) return null;
            const plans: CandidatePlan<AnnotationCandidateLeaf>[] = [];
            const plan =
              filter &&
              planCandidates(
                filter.root,
                hydration.candidateSources(library),
                lowerAnnotationCandidate,
              );
            if (plan) plans.push(plan);
            for (const target of ["item", "attachment"] as const) {
              const keys = request[target];
              if (keys)
                plans.push({
                  kind: "leaf",
                  leaf: {
                    kind: "selector",
                    target,
                    keys: keys.flatMap((key) => {
                      const parsed = parseIndexedKey(key);
                      return parsed && parsed.groupID === library.groupID
                        ? [parsed.key]
                        : [];
                    }),
                  },
                });
            }
            if (!plans.length) return null;
            const rowCount = yield* readAnnotationRowCount(library.libraryID);
            const cap = Math.floor(rowCount * tuning.capRatio);
            return yield* readCandidatePlan(
              { kind: "all", plans },
              {
                libraryID: library.libraryID,
                cap,
                readLeaf: readAnnotationCandidateSet,
              },
            );
          }),
        matches: (item) =>
          (!filter || isMatch(filter.root, item, clock)) &&
          (!request.item ||
            request.item.includes(
              formatIndexedKey(item.scan.parent.key, item.groupID),
            )) &&
          (!request.attachment ||
            request.attachment.includes(
              formatIndexedKey(item.scan.attachmentKey, item.groupID),
            )),
        keys: (item) => [
          ...(request.sort === undefined
            ? [
                item.scan.parent.dateModified,
                item.scan.attachmentKey,
                item.scan.sortIndex,
              ]
            : sorts.map((sort) => sort.key(item, clock))),
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
  }).pipe(
    Effect.mapError((error) =>
      error instanceof ItemQueryError
        ? new ItemQueryError({
            fault: error.fault,
            location: error.location,
            argumentText: error.argumentText,
            dataset: "annotations",
          })
        : error,
    ),
  );
}
