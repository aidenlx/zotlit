// The Annotations dataset: Annotation Query over the non-trashed Annotations
// of the Target Libraries, on the same bounded execution as Item Query.
import { Effect } from "effect";

import { formatIndexedKey, parseIndexedKey } from "@zotlit/db";
import {
  readAnnotationRowCount,
  readAnnotationCandidateSet,
  readAnnotationScanPage,
  readAnnotationUniverseRows,
} from "@zotlit/db/item-query";
import type { AnnotationCandidateLeaf } from "@zotlit/db/item-query";

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
import { openAnnotationHydration } from "./annotation-hydration";
import { planCandidates, readCandidatePlan } from "./candidate-plan";
import type { CandidatePlan } from "./candidate-plan";
import { fieldRoot } from "./dataset";
import type { QueryDataset } from "./dataset";
import type { DatasetRun } from "./execution";
import { BUILT_IN_NAMES } from "./fields";
import { matches as isMatch } from "./filter-evaluate";
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
    return prefix + fieldRoot(name.slice(prefix.length));
  },
  readScanPage: readAnnotationScanPage,
  readUniverseRows: readAnnotationUniverseRows,
  open: (plan, request, clock) =>
    Effect.gen(function* () {
      const { filter, paths } = plan;
      const hydration = yield* openAnnotationHydration(plan, request.libraries);
      const run: DatasetRun<QueryAnnotation> = {
        scan: hydration.scan,
        projection: hydration.projection,
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
