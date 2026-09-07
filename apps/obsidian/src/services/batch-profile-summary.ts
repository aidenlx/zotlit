// Shared summary text for Profile-aware literature-note and Imported Note runs.
import * as m from "@/lib/i18n/generated/messages";

import type { BatchRunResult } from "./batch-run";

export interface BatchProfileCount {
  label: string;
  created: number;
  updated: number;
}

export function batchProfileSummary(
  result: BatchRunResult,
  options: {
    profiles: readonly BatchProfileCount[];
    kept?: number;
    notFound?: number;
    cancelled: boolean;
    aborted: boolean;
  },
): string {
  const created = options.profiles
    .filter((profile) => profile.created > 0)
    .map((profile) =>
      m.batch_profile_created({ count: profile.created, label: profile.label }),
    )
    .join(", ");
  const updated = options.profiles
    .filter((profile) => profile.updated > 0)
    .map((profile) =>
      m.batch_profile_updated({ count: profile.updated, label: profile.label }),
    )
    .join(", ");
  const message = options.aborted
    ? m.batch_profile_summary_aborted
    : options.cancelled
      ? m.batch_profile_summary_cancelled
      : m.batch_profile_summary;
  return message({
    created: created || m.batch_profile_created_none(),
    updated: updated || m.batch_profile_updated_none(),
    failed: result.failed,
    skipped: result.skipped,
    kept: options.kept ?? 0,
    notFound: options.notFound ?? 0,
  });
}
