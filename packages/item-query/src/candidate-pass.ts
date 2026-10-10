import { getLogger } from "@logtape/logtape";
import { Effect } from "effect";

import type { CandidateDataset } from "./dataset";
import type { FilterNode } from "./filter-plan";
import type { QuerySources } from "./query-sources";
import {
  planDatasetCandidates,
  readDatasetCandidates,
} from "./relation-candidates";
import type { TargetLibrary } from "./request";
import type { Tuning } from "./tuning";

const logger = getLogger(["zotlit", "item-query"]);

/** Choose the candidate set or the scan independently for each Target Library. */
export const runCandidatePass = Effect.fnUntraced(function* ({
  dataset,
  filter,
  sources,
  library,
  tuning,
}: {
  dataset: CandidateDataset;
  filter: FilterNode<never> | undefined;
  sources: Pick<QuerySources, "candidateContext">;
  library: TargetLibrary;
  tuning: Tuning;
}) {
  const plan =
    filter && !tuning.forceScan
      ? planDatasetCandidates(filter, sources, { dataset, library })
      : null;
  const cap = plan
    ? Math.floor(
        (yield* dataset.readRowCount(library.libraryID)) * tuning.capRatio,
      )
    : null;
  const candidates = plan
    ? yield* readDatasetCandidates(plan, library.libraryID, cap!)
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
            : plan
              ? "candidate-cap-exceeded"
              : "unsupported-filter",
  });
  return candidates;
});
