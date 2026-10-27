// The note commands and menu entries as Effect code: each asks what it must,
// runs, and reports on a notice.
import { Effect } from "effect";
import type { App, TFile } from "obsidian";

import { awaitConfirm } from "@/lib/confirm";
import { recover } from "@/lib/effect-cause";
import * as m from "@/lib/i18n/generated/messages";
import type { Notifier, ProgressCopy } from "@/lib/notifier";
import { reportOutcome, withProgress } from "@/lib/notifier";
import { missingPartialNotice } from "@/lib/workbench-recovery";
import { reimportNoteByKey } from "@/services/note-import/batch-import";
import type {
  BatchImportPorts,
  BatchImportServices,
  ReimportResult,
} from "@/services/note-import/batch-import";
import { importedNoteProfileErrorNotice } from "@/services/note-import/batch-import-notices";
import { isInertTemplateError } from "@/services/template/errors";
import type { ZoteroPref } from "@/services/zotero-pref/service";

import type { InteractiveCreationPorts } from "./creation-view";
import { plainNoteError } from "./errors";
import type { NoteOperationDiagnostic, UpdateScope } from "./operations";
import { NoteFeature } from "./service";
import { switchNoteProfileInteractively } from "./switch-view";
import { runBatchUpdateAll } from "./update-batch";
import type {
  BatchUpdatePorts,
  BatchUpdateResult,
  BatchUpdateServices,
} from "./update-batch";
import {
  noteOperationDiagnosticContent,
  updateNoteToast,
  updateWithNotice,
} from "./update-single";

/** The services the note actions read. */
export type NoteActionServices =
  | BatchImportServices
  | BatchUpdateServices
  | NoteFeature
  | Notifier
  | ZoteroPref;

/** The legacy values the note actions call: the dialogs and the import and update modals. */
export interface NoteActionPorts extends InteractiveCreationPorts {
  readonly batchImport: BatchImportPorts;
  readonly batchUpdate: BatchUpdatePorts;
}

/** The notice tells the user how the task went, so a failure ends here; an interrupt passes. */
const reported = recover(() => Effect.void, Effect.void);

/** Change `file`'s Profile after the user picks one and consents. */
export const switchProfile = Effect.fn("NoteActions.switchProfile")(function* (
  ports: NoteActionPorts,
  file: TFile,
) {
  yield* switchNoteProfileInteractively(ports, file);
});

/** Update `file` at `scope` behind its progress notice. */
export const updateNote = Effect.fn("NoteActions.updateNote")(function* (
  ports: NoteActionPorts,
  file: TFile,
  options: { itemKey: string; scope: UpdateScope },
) {
  yield* reported(
    updateWithNotice(
      file,
      { indexedKey: options.itemKey, scope: options.scope },
      updateNoteToast(options.scope, { app: ports.app }),
    ),
  );
});

/** Overwrite `file` from its Item after the user confirms it. */
export const overwriteNote = Effect.fn("NoteActions.overwriteNote")(function* (
  ports: NoteActionPorts,
  file: TFile,
  itemKey: string,
) {
  const yes = yield* awaitConfirm(
    {
      title: m.modal_overwrite_note_title(),
      content: m.modal_overwrite_note_desc(),
      action: m.modal_overwrite_note_confirm(),
      destructive: true,
    },
    ports.app,
  );
  if (!yes) return;
  yield* reported(
    withProgress(
      (yield* NoteFeature).overwriteNote(file, itemKey),
      overwriteNoteToast({ app: ports.app }),
    ),
  );
});

/** Reimport the Imported Note `file` from its Zotero note after the user confirms it. */
export const reimportNote = Effect.fn("NoteActions.reimportNote")(function* (
  ports: NoteActionPorts,
  file: TFile,
  noteKey: string,
) {
  const yes = yield* awaitConfirm(
    {
      title: m.modal_reimport_note_title(),
      content: m.modal_reimport_note_desc(),
      action: m.modal_reimport_note_confirm(),
      destructive: true,
    },
    ports.app,
  );
  if (!yes) return;
  yield* reported(
    withProgress(
      reimportNoteByKey(ports.batchImport, noteKey, file),
      reimportNoteToast({ app: ports.app, path: file.path }),
    ),
  );
});

/**
 * Run the Update all notes flow and report its outcome: the batch confirm
 * modal the command opens, reused wherever else that flow is offered.
 */
export const updateAll = Effect.fn("NoteActions.updateAll")(function* (
  ports: NoteActionPorts,
) {
  yield* reportOutcome(runBatchUpdateAll(ports.batchUpdate), {
    success: batchUpdateAllNotice,
    error: () => undefined,
  });
});

/** The copy one Reimport note reports with. */
export function reimportNoteToast(options: {
  app: App;
  path: string;
}): ProgressCopy<ReimportResult> {
  return {
    loading: m.notice_reimporting_note(),
    success: reimportNoteNotice,
    error: (e) =>
      missingPartialNotice(e, options) ??
      (isInertTemplateError(e)
        ? e.message
        : (importedNoteProfileErrorNotice(e, options) ??
          m.notice_reimport_note_failed())),
  };
}

function reimportNoteNotice(result: ReimportResult): string {
  switch (result.outcome) {
    case "db-unavailable":
      return m.batch_update_db_unavailable();
    case "not-found":
      return m.notice_protocol_item_not_found();
    case "created":
    case "overwritten":
      return m.notice_reimported_note();
    case "skipped":
      return m.notice_reimport_note_skipped();
  }
}

/**
 * The copy one Overwrite note reports with. A Note Feature failure shows what
 * its render or rewrite threw.
 */
export function overwriteNoteToast(options: { app: App }): ProgressCopy<{
  diagnostic?: NoteOperationDiagnostic;
}> {
  return {
    loading: m.notice_overwriting_note(),
    success: (result) =>
      result.diagnostic
        ? noteOperationDiagnosticContent(options.app, result.diagnostic)
        : m.notice_overwrote_note(),
    error: (failure) => {
      const e = plainNoteError(failure);
      return (
        missingPartialNotice(e, options) ??
        (isInertTemplateError(e) ? e.message : m.notice_overwrite_note_failed())
      );
    },
  };
}

/** The notice an Update all notes outcome reports with, or none. */
export function batchUpdateAllNotice(
  result: BatchUpdateResult,
): string | undefined {
  switch (result.outcome) {
    case "db-unavailable":
      return m.batch_update_db_unavailable();
    case "empty-selection":
      return m.batch_update_all_empty();
    case "no-library-in-scope":
      return m.batch_all_no_library_in_scope();
    default:
      return undefined;
  }
}
