// The Attachments dataset: Attachment Query over the non-trashed Attachments
// of the Target Libraries, on the same bounded execution as Item Query.
import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import {
  readAttachmentCandidateSet,
  readRelationCandidateSet,
  readAttachmentRowCount,
  readAttachmentScanPage,
  readAttachmentUniverseRows,
} from "@zotlit/db/item-query";

import { lowerAttachmentCandidate } from "./attachment-candidates";
import {
  ATTACHMENT_FIELDS,
  ATTACHMENT_SORT_FIELDS,
  attachmentFieldDefinition,
  attachmentFilterRegistry,
  attachmentSortableField,
  DEFAULT_ATTACHMENT_FIELDS,
} from "./attachment-fields";
import type { QueryAttachment } from "./attachment-fields";
import { openAttachmentHydration } from "./attachment-hydration";
import { fieldRoot } from "./dataset";
import type { QueryDataset } from "./dataset";
import type { DatasetRun } from "./execution";
import { BUILT_IN_NAMES } from "./fields";
import { matches as isMatch } from "./filter-evaluate";
import { planFilter } from "./filter-plan";
import { readPath } from "./projection";
import { ANNOTATIONS } from "./query-annotations";
import {
  planDatasetCandidates,
  readDatasetCandidates,
} from "./relation-candidates";
import type { ItemQueryRequest } from "./request";

const PARENT = "item.";

/** Attachment Query: one Attachment Row for each non-trashed Attachment. */
export const ATTACHMENTS: QueryDataset<ItemQueryRequest> = {
  id: "attachments",
  noun: "Attachment",
  family: "Attachment Query",
  customPrefix: PARENT,
  defaultFields: DEFAULT_ATTACHMENT_FIELDS,
  defaultSort: [{ field: "dateModified", direction: "desc" }],
  tieBreakers: [],
  names: [
    ...ATTACHMENT_FIELDS.keys(),
    "item",
    ...BUILT_IN_NAMES.map((name) => PARENT + name),
  ],
  lowerCandidate: (node, sources) => {
    const leaf = lowerAttachmentCandidate(node, sources);
    return leaf
      ? (options) => readAttachmentCandidateSet({ ...options, leaf })
      : null;
  },
  candidateRelations: {
    annotations: {
      dataset: () => ANNOTATIONS,
      readParents: (chunk) =>
        readRelationCandidateSet({
          ...chunk,
          relation: "attachment-annotations",
        }),
    },
  },
  sortableFields: ATTACHMENT_SORT_FIELDS,
  definition: attachmentFieldDefinition,
  filterField: (name) => attachmentFilterRegistry.field(name),
  planFilter: (text) => planFilter(text, attachmentFilterRegistry),
  sortable: attachmentSortableField,
  // A parent field is the two leading segments `item` and its name.
  resolvePath: (segments) => {
    const [root, next] = segments;
    const parent =
      root === "item" && typeof next === "string"
        ? attachmentFieldDefinition(PARENT + next)
        : undefined;
    if (parent) return { field: parent, rest: segments.slice(2) };
    const field =
      typeof root === "string" ? attachmentFieldDefinition(root) : undefined;
    return field && { field, rest: segments.slice(1) };
  },
  rootName: (name) => {
    const prefix = name.startsWith(PARENT) ? PARENT : "";
    return prefix + fieldRoot(name.slice(prefix.length));
  },
  readScanPage: readAttachmentScanPage,
  readUniverseRows: readAttachmentUniverseRows,
  open: (plan, request, clock) =>
    Effect.gen(function* () {
      const { filter, paths } = plan;
      const hydration = yield* openAttachmentHydration(plan, request.libraries);
      const run: DatasetRun<QueryAttachment> = {
        scan: hydration.scan,
        projection: hydration.projection,
        candidates: (library, tuning) =>
          Effect.gen(function* () {
            if (tuning.forceScan) return null;
            const candidatePlan =
              filter &&
              planDatasetCandidates(
                filter.root,
                hydration.candidateSources(library),
                { dataset: ATTACHMENTS },
              );
            if (!candidatePlan) return null;
            const rowCount = yield* readAttachmentRowCount(library.libraryID);
            const cap = Math.floor(rowCount * tuning.capRatio);
            return yield* readDatasetCandidates(
              candidatePlan,
              library.libraryID,
              cap,
            );
          }),
        matches: (item) => !filter || isMatch(filter.root, item, clock),
        project: (item, library) => ({
          indexedKey: formatIndexedKey(item.scan.key, library.groupID),
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
