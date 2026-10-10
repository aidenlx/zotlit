// The Annotations dataset: Annotation Query over the non-trashed Annotations
// of the Target Libraries, on the same bounded execution as Item Query.
import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import {
  readParentCandidateSet,
  readAnnotationCandidateSet,
  readAnnotationRowCount,
  readAnnotationScanPage,
  readAnnotationUniverseRows,
} from "@zotlit/db/item-query";

import { lowerAnnotationCandidate } from "./annotation-candidates";
import {
  ANNOTATION_FIELDS,
  ANNOTATION_PARENTS,
  ANNOTATION_SORT_FIELDS,
  annotationFieldDefinition,
  annotationFilterRegistry,
  annotationSortableField,
  DEFAULT_ANNOTATION_FIELDS,
} from "./annotation-fields";
import type { QueryAnnotation } from "./annotation-fields";
import { ANNOTATION_LOADING } from "./annotation-hydration";
import type { QueryDataset } from "./dataset";
import type { DatasetRun } from "./execution";
import { matches as isMatch } from "./filter-evaluate";
import { planFilter } from "./filter-plan";
import { parentPathResolver, parentRootName } from "./parent-records";
import { readPath } from "./projection";
import { ATTACHMENTS } from "./query-attachments";
import { ITEMS } from "./query-items";
import { openRecordLoader } from "./record-loader";
import type { ItemQueryRequest } from "./request";

/** Annotation Query: one Annotation Row for each non-trashed Annotation. */
export const ANNOTATIONS: QueryDataset<ItemQueryRequest> = {
  id: "annotations",
  noun: "Annotation",
  family: "Annotation Query",
  customPrefix: `${annotationFilterRegistry.prefix}.`,
  defaultFields: DEFAULT_ANNOTATION_FIELDS,
  defaultSort: [
    { field: "item.dateModified", direction: "desc" },
    { field: "attachment.indexedKey", direction: "asc" },
    { field: "sortIndex", direction: "asc" },
  ],
  tieBreakers: [{ field: "sortIndex", direction: "asc" }],
  get names() {
    return [
      ...ANNOTATION_FIELDS.keys(),
      ...ANNOTATION_PARENTS.flatMap((parent) => parent.names()),
    ];
  },
  lowerCandidate: lowerAnnotationCandidate,
  readCandidate: readAnnotationCandidateSet,
  readRowCount: readAnnotationRowCount,
  candidateParents: ANNOTATION_PARENTS,
  candidateRelations: {
    item: {
      dataset: () => ITEMS,
      readChildren: ({ leaf, ...page }) =>
        readParentCandidateSet({ ...page, leaf, relation: "annotation-item" }),
    },
    attachment: {
      dataset: () => ATTACHMENTS,
      readChildren: ({ leaf, ...page }) =>
        readParentCandidateSet({
          ...page,
          leaf,
          relation: "annotation-attachment",
        }),
    },
  },
  sortableFields: ANNOTATION_SORT_FIELDS,
  definition: annotationFieldDefinition,
  filterField: (name) => annotationFilterRegistry.field(name),
  planFilter: (text) => planFilter(text, annotationFilterRegistry),
  sortable: annotationSortableField,
  resolvePath: parentPathResolver(
    annotationFieldDefinition,
    ANNOTATION_PARENTS,
  ),
  rootName: (name) => parentRootName(name, ANNOTATION_PARENTS),
  readScanPage: readAnnotationScanPage,
  readUniverseRows: readAnnotationUniverseRows,
  open: (plan, request, { clock, sources }) =>
    Effect.gen(function* () {
      const { filter, paths } = plan;
      const hydration = yield* openRecordLoader(ANNOTATION_LOADING, plan, {
        libraries: request.libraries,
        sources,
      });
      const run: DatasetRun<QueryAnnotation> = {
        scan: hydration.scan,
        projection: hydration.projection,
        matches: (item) => !filter || isMatch(filter.root, item, clock),
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
