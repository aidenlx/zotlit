// The Items dataset: Item Query over the top-level, non-trashed Items of the
// Target Libraries.
import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import {
  readCandidateSet,
  readRelationCandidateSet,
  readLibraryRowCount,
  readScanPage,
  readUniverseRows,
} from "@zotlit/db/item-query";

import { lowerItemCandidate } from "./candidate-plan";
import { fieldRoot } from "./dataset";
import type { QueryDataset } from "./dataset";
import type { DatasetRun } from "./execution";
import {
  BUILT_IN_NAMES,
  DEFAULT_FIELDS,
  fieldDefinition,
  filterField,
} from "./fields";
import type { QueryItem } from "./fields";
import { matches as isMatch } from "./filter-evaluate";
import { planFilter } from "./filter-plan";
import { ITEM_LOADING } from "./hydration";
import { readPath, resolveItemPath } from "./projection";
import { ANNOTATIONS } from "./query-annotations";
import { ATTACHMENTS } from "./query-attachments";
import { openRecordLoader } from "./record-loader";
import type { ItemQueryRequest } from "./request";

const sortable = (name: string) => {
  const definition = fieldDefinition(name);
  return definition?.sortKey
    ? { needs: definition.needs([]), key: definition.sortKey }
    : undefined;
};

/** Item Query: one row for each top-level, non-trashed Item. */
export const ITEMS: QueryDataset<ItemQueryRequest> = {
  id: "items",
  noun: "Item",
  family: "Item Query",
  customPrefix: "",
  defaultFields: DEFAULT_FIELDS,
  defaultSort: [{ field: "dateModified", direction: "desc" }],
  tieBreakers: [],
  names: BUILT_IN_NAMES,
  lowerCandidate: lowerItemCandidate,
  readCandidate: readCandidateSet,
  readRowCount: readLibraryRowCount,
  candidateParents: [],
  candidateRelations: {
    attachments: {
      dataset: () => ATTACHMENTS,
      readParents: (chunk) =>
        readRelationCandidateSet({ ...chunk, relation: "item-attachments" }),
    },
    annotations: {
      dataset: () => ANNOTATIONS,
      readParents: (chunk) =>
        readRelationCandidateSet({ ...chunk, relation: "item-annotations" }),
    },
  },
  sortableFields: BUILT_IN_NAMES.filter((name) => sortable(name)),
  definition: fieldDefinition,
  filterField,
  planFilter: (text) => planFilter(text),
  sortable,
  resolvePath: resolveItemPath,
  rootName: fieldRoot,
  readScanPage,
  readUniverseRows,
  open: (plan, { libraries }, { clock, sources }) =>
    Effect.gen(function* () {
      const { filter, paths } = plan;
      const hydration = yield* openRecordLoader(ITEM_LOADING, plan, {
        libraries,
        sources,
      });
      const run: DatasetRun<QueryItem> = {
        scan: hydration.scan,
        projection: hydration.projection,
        matches: (item) => !filter || isMatch(filter.root, item, clock),
        project: (item, library, scan) => ({
          indexedKey: formatIndexedKey(scan.key, library.groupID),
          values: Object.fromEntries(
            paths.map((path) => [path.text, readPath(path, item)]),
          ),
        }),
      };
      return run;
    }),
};
