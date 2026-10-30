// Outcome notices of the protocol handlers: what each refused link, early exit
// or failure of a link-started run tells the user.

import { Effect } from "effect";
import type { App } from "obsidian";

import * as m from "@/lib/i18n/generated/messages";
import { Notifier, reportOutcome } from "@/lib/notifier";
import type { NoticeMessage, OutcomeCopy } from "@/lib/notifier";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import type { BatchUpdateResult } from "@/services/note-feature/update-batch";
import { noteOperationDiagnosticNotice } from "@/services/note-feature/update-single";
import {
  batchImportAllToast,
  batchImportToast,
  importNotices,
} from "@/services/note-import/batch-import-notices";

import { ProtocolOutcome } from "./outcome";

/**
 * Show the notice of a protocol outcome: a refusal shows its message; a run
 * reports its result for 2 s or its failure for 4 s, as {@link reportOutcome}
 * does. An ignored link, an open, and a cancel show none.
 */
export const showProtocolOutcome = Effect.fn("protocol.showProtocolOutcome")(
  function* (outcome: ProtocolOutcome, options: { readonly app?: App }) {
    const notifier = yield* Notifier;
    const show = (message: NoticeMessage) =>
      Effect.asVoid(notifier.show(message));
    yield* ProtocolOutcome.$match(outcome, {
      InvalidLink: () => show(m.notice_protocol_invalid()),
      ForeignSource: () => Effect.void,
      DatabaseUnavailable: () => show(m.notice_protocol_db_unavailable()),
      ItemNotFound: () => show(m.notice_protocol_item_not_found()),
      UnknownProfile: ({ text }) =>
        show(noteOperationDiagnosticNotice(unknownProfileDiagnostic(text))),
      Opened: () => Effect.void,
      UpdateMany: ({ exit }) => reportOutcome(exit, batchUpdateToast),
      UpdateAll: ({ exit }) => reportOutcome(exit, updateAllToast),
      ImportNotes: ({ exit }) =>
        reportOutcome(exit, importNotices(batchImportToast(options))),
      ImportAllNotes: ({ exit }) =>
        reportOutcome(exit, importNotices(batchImportAllToast(options))),
      ProfileOpened: () => Effect.void,
      ProfileImportCancelled: () => Effect.void,
      ProfileImportFailed: () => show(m.notice_profile_action_failed()),
    });
  },
);

/** A batch update's notices: the early-exit outcomes; a failure shows none. */
const batchUpdateToast: OutcomeCopy<BatchUpdateResult> = {
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
const updateAllToast: OutcomeCopy<BatchUpdateResult> = {
  success: updateAllNotice,
  error: () => undefined,
};
