// The Items dataset: Item Query over the top-level, non-trashed Items of the
// Target Libraries.
import { getLogger } from "@logtape/logtape";
import { Effect } from "effect";

import { formatIndexedKey } from "@zotlit/db";
import {
  readLibraryRowCount,
  readScanPage,
  readUniverseRows,
} from "@zotlit/db/item-query";

import { planCandidates, readCandidates } from "./candidate-plan";
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
import { openHydration } from "./hydration";
import { readPath, resolveItemPath } from "./projection";
import type { ItemQueryRequest } from "./request";

const logger = getLogger(["zotlit", "item-query"]);

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
  sortableFields: BUILT_IN_NAMES.filter((name) => sortable(name)),
  definition: fieldDefinition,
  filterField,
  planFilter: (text) => planFilter(text),
  sortable,
  resolvePath: resolveItemPath,
  rootName: fieldRoot,
  readScanPage,
  readUniverseRows,
  open: (plan, { libraries }, clock) =>
    Effect.gen(function* () {
      const { filter, paths } = plan;
      const hydration = yield* openHydration(plan, libraries);
      const run: DatasetRun<QueryItem> = {
        scan: hydration.scan,
        projection: hydration.projection,
        candidates: (library, tuning) =>
          Effect.gen(function* () {
            const candidatePlan =
              filter && !tuning.forceScan
                ? planCandidates(
                    filter.root,
                    hydration.candidateSources(library),
                  )
                : null;
            const cap = candidatePlan
              ? Math.floor(
                  (yield* readLibraryRowCount(library.libraryID)) *
                    tuning.capRatio,
                )
              : null;
            const candidates = candidatePlan
              ? yield* readCandidates(candidatePlan, library.libraryID, cap!)
              : null;
            logger.debug("Item Query uses {plan} for Library {libraryID}", {
              libraryID: library.libraryID,
              groupID: library.groupID,
              plan: candidates === null ? "scan" : "candidates",
              candidateCount: candidates?.size ?? null,
              candidateCap: cap,
              reason:
                candidates !== null
                  ? null
                  : !filter
                    ? "no-filter"
                    : tuning.forceScan
                      ? "forced-scan"
                      : candidatePlan
                        ? "candidate-cap-exceeded"
                        : "unsupported-filter",
            });
            return candidates;
          }),
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
