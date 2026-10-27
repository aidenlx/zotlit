// Outcome notices of the protocol handlers: what each early exit or failure
// of a link-started batch update or import tells the user.

import * as m from "@/lib/i18n/generated/messages";
import type { NoticeMessage, OutcomeCopy } from "@/lib/notifier";
import * as toast from "@/lib/toast";
import type { BatchUpdateResult } from "@/services/note-feature/update-batch";

/** The outcome notice of a note import, from its toast copy. */
export function importNotices<A>(copy: {
  success: (result: A) => NoticeMessage | undefined;
  error: (message: string, error: unknown) => NoticeMessage | undefined;
}): OutcomeCopy<A> {
  return {
    success: copy.success,
    error: (error) => copy.error(toast.formatErrorMessage(error), error),
  };
}

/** A batch update's notices: the early-exit outcomes; a failure shows none. */
export const batchUpdateToast = {
  success: batchUpdateNotice,
  error: () => undefined,
};

function batchUpdateNotice(result: BatchUpdateResult): string | undefined {
  switch (result.outcome) {
    case "db-unavailable":
      return m.batch_update_db_unavailable();
    case "empty-selection":
    case "not-found":
      return m.notice_protocol_item_not_found();
    default:
      return undefined;
  }
}

function updateAllNotice(result: BatchUpdateResult): string | undefined {
  switch (result.outcome) {
    case "db-unavailable":
      return m.batch_update_db_unavailable();
    case "empty-selection":
      return m.batch_update_all_empty();
    case "no-library-in-scope":
      return m.batch_all_no_library_in_scope();
    case "unavailable-target":
      return m.batch_all_library_unavailable();
    case "collection-not-found":
      return m.notice_collection_not_found();
    default:
      return undefined;
  }
}

/** An update-all link's notices: the early-exit outcomes; a failure shows none. */
export const updateAllToast: OutcomeCopy<BatchUpdateResult> = {
  success: updateAllNotice,
  error: () => undefined,
};
