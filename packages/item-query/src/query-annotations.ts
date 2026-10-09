// The Annotations dataset: Annotation Query over the non-trashed Annotations
// of the Target Libraries, on the same bounded execution as Item Query.
import { Effect } from "effect";

import { formatIndexedKey, parseIndexedKey } from "@zotlit/db";
import {
  readAnnotationHydrateChunk,
  readAnnotationRowCount,
  readAnnotationCandidateSet,
  readAnnotationScanPage,
  readAnnotationUniverseRows,
  readFieldVocabulary,
} from "@zotlit/db/item-query";
import type {
  AnnotationCandidateLeaf,
  AnnotationScanRow,
} from "@zotlit/db/item-query";

import { lowerAnnotationCandidate } from "./annotation-candidates";
import {
  ANNOTATION_FIELDS,
  ANNOTATION_SORT_FIELDS,
  annotationFieldDefinition,
  annotationFilterRegistry,
  annotationSortableField,
  DEFAULT_ANNOTATION_FIELDS,
  planAnnotationFilter,
} from "./annotation-fields";
import type { QueryAnnotation } from "./annotation-fields";
import { planCandidates, readCandidatePlan } from "./candidate-plan";
import type { CandidatePlan } from "./candidate-plan";
import { AttachmentFileResolver } from "./dataset";
import type { QueryDataset } from "./dataset";
import type { DatasetRun } from "./execution";
import { BUILT_IN_NAMES } from "./fields";
import { matches as isMatch } from "./filter-evaluate";
import { openHydration } from "./hydration";
import { readPath } from "./projection";
import type { AnnotationQueryRequest } from "./request";

const PARENT = "item.";

/** Annotation Query: one Annotation Row for each non-trashed Annotation. */
export const ANNOTATIONS: QueryDataset<AnnotationQueryRequest> = {
  id: "annotations",
  noun: "Annotation",
  family: "Annotation Query",
  customPrefix: PARENT,
  defaultFields: DEFAULT_ANNOTATION_FIELDS,
  defaultSort: [
    { field: "item.dateModified", direction: "desc" },
    { field: "attachment.indexedKey", direction: "asc" },
    { field: "sortIndex", direction: "asc" },
  ],
  tieBreakers: [{ field: "sortIndex", direction: "asc" }],
  names: [
    ...ANNOTATION_FIELDS.keys(),
    "item",
    "item.indexedKey",
    ...BUILT_IN_NAMES.map((name) => PARENT + name),
  ],
  sortableFields: ANNOTATION_SORT_FIELDS,
  definition: annotationFieldDefinition,
  filterField: (name) => annotationFilterRegistry.field(name),
  planFilter: planAnnotationFilter,
  sortable: annotationSortableField,
  // A parent field is the two leading segments `item` and its name.
  resolvePath: (segments) => {
    const [root, next] = segments;
    const parent =
      root === "item" && typeof next === "string"
        ? annotationFieldDefinition(PARENT + next)
        : undefined;
    if (parent) return { field: parent, rest: segments.slice(2) };
    const field =
      typeof root === "string" ? annotationFieldDefinition(root) : undefined;
    return field && { field, rest: segments.slice(1) };
  },
  rootName: (name) => {
    const prefix = name.startsWith(PARENT) ? PARENT : "";
    return prefix + name.slice(prefix.length).split(".")[0]!.split("[")[0]!;
  },
  readScanPage: readAnnotationScanPage,
  readUniverseRows: readAnnotationUniverseRows,
  open: (plan, request, clock) =>
    Effect.gen(function* () {
      const { filter, paths } = plan;
      const hydration = yield* openHydration(plan, request.libraries);
      const vocabulary = yield* readFieldVocabulary();
      const resolveAttachmentFile = yield* AttachmentFileResolver;
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
              (library) =>
                library.libraryID === annotation.attachment.libraryID,
            )!.groupID;
            const file =
              projection &&
              resolveAttachmentFile &&
              paths.some(
                (path) =>
                  path.text === "attachment" ||
                  path.text.startsWith("attachment."),
              )
                ? yield* resolveAttachmentFile({
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
      const run: DatasetRun<QueryAnnotation> = {
        scan: { plan: true, load: load(false) },
        projection: { plan: true, load: load(true) },
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
        project: (item, library) => ({
          indexedKey: formatIndexedKey(item.scan.key, library.groupID),
          attachmentIndexedKey: formatIndexedKey(
            item.scan.attachmentKey,
            library.groupID,
          ),
          itemIndexedKey: formatIndexedKey(
            item.scan.parent.key,
            library.groupID,
          ),
          values: Object.fromEntries(
            paths.map((path) => [path.text, readPath(path, item)]),
          ),
        }),
      };
      return run;
    }),
};
