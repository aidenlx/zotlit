import * as m from "@/lib/i18n/generated/messages";
// Pure BatchImportResult → user-facing string mappings for notices and toasts.
import type { BatchRunResult } from "@/services/batch-run";

import type { BatchImportResult } from "./batch-import";

/** Map preflight import outcomes to a notice; modal/cancelled paths are silent. */
export function batchImportNotice(
  result: BatchImportResult,
): string | undefined {
  switch (result.outcome) {
    case "db-unavailable":
      return m.batch_update_db_unavailable();
    case "empty-selection":
      return m.notice_protocol_item_not_found();
    case "not-found":
      return m.batch_import_not_found({ count: result.count });
    case "single":
      if (result.write === "created") {
        return m.notice_imported_note({ title: result.title });
      }
      if (result.write === "overwritten") {
        return m.notice_updated_imported_note({ title: result.title });
      }
      return m.notice_reimport_note_skipped();
    case "batch-modal":
    case "cancelled":
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Notices for a library-wide or collection-scoped import. Its early exits carry
 * their own copy — an empty scope is a plain "nothing to import", not the
 * missing-item report an explicit id list would get.
 */
export function batchImportAllNotice(
  result: BatchImportResult,
): string | undefined {
  switch (result.outcome) {
    case "empty-selection":
      return m.batch_import_all_empty();
    case "no-library-in-scope":
      return m.batch_all_no_library_in_scope();
    case "unavailable-target":
      return m.batch_all_library_unavailable();
    case "collection-not-found":
      return m.notice_collection_not_found();
    default:
      return batchImportNotice(result);
  }
}

export function batchImportAllToast(): {
  success: (result: BatchImportResult) => string | undefined;
  error: string;
} {
  return {
    success: batchImportAllNotice,
    error: m.batch_import_failed(),
  };
}

export function batchImportToast(): {
  success: (result: BatchImportResult) => string | undefined;
  error: string;
} {
  return {
    success: batchImportNotice,
    error: m.batch_import_failed(),
  };
}

export function childImportToast(): {
  success: (result: BatchImportResult | null) => string | undefined;
  error: string;
} {
  return {
    success: (result) =>
      result ? batchImportNotice(result) : m.notice_protocol_item_not_found(),
    error: m.batch_import_failed(),
  };
}

/** Build the run-summary copy; `notFound` is captured from classification. */
export function importRunSummary(
  notFound: () => number,
): (
  result: BatchRunResult,
  state: { cancelled: boolean; aborted: boolean },
) => string {
  return (result, state) => {
    const { created, updated, skipped, failed } = result;
    if (state.aborted) {
      return m.batch_import_aborted({ created, updated, skipped, failed });
    }
    if (state.cancelled) {
      return m.batch_import_summary_cancelled({
        created,
        updated,
        skipped,
        failed,
      });
    }
    return m.batch_import_summary({
      created,
      updated,
      skipped,
      failed,
      notFound: notFound(),
    });
  };
}
