import { Effect } from "effect";
import type { App, TFile } from "obsidian";

import { recover } from "@/lib/effect-cause";
import * as m from "@/lib/i18n/generated/messages";
import { BaseNotice } from "@/lib/notice";
import { withProgress } from "@/lib/notifier";
import type { NoticeMessage, ProgressCopy } from "@/lib/notifier";
import { profileRecoveryNotice } from "@/lib/profile-recovery";
import { missingPartialNotice } from "@/lib/workbench-recovery";
import { plainNoteError } from "@/services/note-feature/errors";
import { EmptyFilenameError } from "@/services/note-feature/filename";
import type {
  CreateNoteResult,
  NoteOperationDiagnostic,
  UpdateResult,
  UpdateScope,
} from "@/services/note-feature/operations";
import { InertTemplateError } from "@/services/template/errors";

import { NoteFeature } from "./service";
import type { UpdateNoteOptions } from "./write-pipeline";

/** The progress notice of a single-note update, with its messages as functions. */
export interface UpdateNoteCopy extends ProgressCopy<UpdateResult> {
  readonly loading: string;
  readonly success: (result: UpdateResult) => NoticeMessage;
  /** The message for what the update failed with; a Note Feature failure shows what its render or rewrite threw. */
  readonly error: (error: unknown) => NoticeMessage;
}

/** Toast copy for a single-note update, framed by `scope`. A `metadata` update
 *  never touches the body, so it reports as "metadata updated" rather than the
 *  full update's region-aware messages. */
export function updateNoteToast(
  scope: UpdateScope,
  options: { app?: App } = {},
): UpdateNoteCopy {
  const diagnosticContent = (diagnostic: NoteOperationDiagnostic) =>
    options.app
      ? noteOperationDiagnosticContent(options.app, diagnostic)
      : noteOperationDiagnosticNotice(diagnostic);
  const error = (failure: unknown): NoticeMessage => {
    const cause = plainNoteError(failure);
    return (
      missingPartialNotice(cause, options) ??
      (cause instanceof InertTemplateError
        ? cause.message
        : m.notice_update_note_failed())
    );
  };
  if (scope === "metadata") {
    return {
      loading: m.notice_updating_note_metadata(),
      success: (result) =>
        result.diagnostic
          ? diagnosticContent(result.diagnostic)
          : m.notice_updated_note_metadata(),
      error,
    };
  }
  return {
    loading: m.notice_updating_note(),
    success: (result) =>
      result.diagnostic
        ? diagnosticContent(result.diagnostic)
        : result.bodyUpdated
          ? m.notice_updated_note()
          : result.noManagedBlock
            ? m.notice_updated_note_no_managed_block()
            : m.notice_updated_note_no_region(),
    error,
  };
}

/**
 * The notices a note update shows. The caller builds them over the `App` that
 * their recovery actions open, so the update itself holds no `App`.
 */
export interface BatchUpdateNotices {
  /** The single update's toast copy for `scope`. */
  readonly updateToast: (scope: UpdateScope) => UpdateNoteCopy;
  /** The standard create notice of one note create. */
  readonly createToast: ProgressCopy<CreateNoteResult>;
  /** The batch modal's notice when its run fails. */
  readonly runFailed: (error: unknown) => string | DocumentFragment;
}

/** The note update's notices, with recovery actions that open in `app`. */
export function batchUpdateNotices(app: App): BatchUpdateNotices {
  return {
    updateToast: (scope) => updateNoteToast(scope, { app }),
    createToast: createNoteToast({ app }, plainNoteError),
    runFailed: (error) => {
      // The modal hands back what the run failed with; a Note Feature
      // failure carries what the render or the rewrite threw.
      const cause = plainNoteError(error);
      return (
        missingPartialNotice(cause, { app }) ??
        (cause instanceof InertTemplateError
          ? cause.message
          : m.batch_update_run_failed())
      );
    },
  };
}

/**
 * Update `file` behind its progress notice. The notice tells the user how the
 * update went, so a typed failure ends here; a defect or an interrupt passes.
 */
export const updateWithNotice = Effect.fnUntraced(function* (
  file: TFile,
  options: UpdateNoteOptions,
  copy: ProgressCopy<UpdateResult>,
) {
  yield* withProgress(
    (yield* NoteFeature).updateNote(file, options),
    copy,
  ).pipe(Effect.ignore);
});

/**
 * Run `create` behind the create notice, started only after the user's Profile
 * decision has settled. `created` replaces the plain success notice, e.g. to
 * name the Profile and path a resolved selection wrote to. Returns the created
 * file, or `null` when the create wrote nothing or failed: the notice already
 * told the user. An interrupt passes.
 */
export const createWithNotice = Effect.fnUntraced(function* <E, R>(
  create: Effect.Effect<CreateNoteResult, E, R>,
  options: { app?: App; created?: (file: TFile) => string } = {},
) {
  const result = yield* withProgress(
    create,
    createNoteToast(options, plainNoteError),
  ).pipe(recover(() => Effect.void, Effect.void));
  return result?.outcome === "created" ? result.file : null;
});

/**
 * The create notice's messages. `plainError` gives what a failure threw, for
 * a caller that holds the failure around it.
 */
function createNoteToast(
  options: { app?: App; created?: (file: TFile) => string },
  plainError: (error: unknown) => unknown = (error) => error,
): ProgressCopy<CreateNoteResult> & {
  error: (error: unknown) => string | DocumentFragment;
} {
  return {
    loading: m.notice_creating_note(),
    success: (result) => createNoteSuccessNotice(result, options),
    error: (error) => {
      const e = plainError(error);
      return (
        missingPartialNotice(e, options) ??
        (e instanceof EmptyFilenameError || e instanceof InertTemplateError
          ? e.message
          : m.notice_create_note_failed())
      );
    },
  };
}

/** The caller's words for a created note, a Profile recovery when the app can offer one, else the plain outcome. */
function createNoteSuccessNotice(
  result: CreateNoteResult,
  options: { app?: App; created?: (file: TFile) => string },
): string | DocumentFragment {
  if (result.outcome === "created" && options.created)
    return options.created(result.file);
  if (
    result.outcome === "refused" &&
    result.diagnostic.code === "unknown-literature-note-profile" &&
    options.app
  )
    return profileRecoveryNotice(options.app, result.diagnostic);
  return createNoteNotice(result);
}

export function createNoteNotice(result: CreateNoteResult): string {
  if (result.outcome === "created") return m.notice_created_note();
  const { diagnostic } = result;
  switch (diagnostic.code) {
    case "literature-note-exists":
      return m.notice_create_note_exists({ path: diagnostic.paths[0] });
    case "duplicate-literature-notes":
      return m.notice_create_note_duplicates({
        paths: diagnostic.paths.join(", "),
      });
    case "unknown-literature-note-profile":
    case "literature-note-profile-conflict":
    case "missing-literature-note-template":
    case "literature-note-template-conversion-required":
    case "managed-frontmatter-refused":
    case "literature-note-key-changed":
    case "literature-note-profile-changed":
      return noteOperationDiagnosticNotice(diagnostic);
  }
}

export function noteOperationDiagnosticNotice(
  diagnostic: NoteOperationDiagnostic,
): string {
  switch (diagnostic.code) {
    case "unknown-literature-note-profile":
      return m.notice_literature_note_profile_unknown({
        stamp: diagnostic.stamp,
      });
    case "literature-note-profile-conflict":
      return m.notice_literature_note_profile_conflict();
    case "missing-literature-note-template":
      return m.notice_literature_note_template_missing({
        document: diagnostic.document,
      });
    case "literature-note-template-conversion-required":
      return m.notice_literature_note_template_conversion_required();
    case "managed-frontmatter-refused":
      return m.notice_managed_frontmatter_refused({
        failures: diagnostic.failures
          .map(({ message, hint }) => `${message} ${hint}`)
          .join(" "),
      });
    case "literature-note-key-changed":
      return m.notice_literature_note_key_changed();
    case "literature-note-profile-changed":
      return m.notice_literature_note_profile_changed();
  }
}

/** Actionable rendering stays at the UI seam; core errors keep plain text. */
export function noteOperationDiagnosticContent(
  app: App,
  diagnostic: NoteOperationDiagnostic,
): string | DocumentFragment {
  return diagnostic.code === "unknown-literature-note-profile"
    ? profileRecoveryNotice(app, diagnostic)
    : noteOperationDiagnosticNotice(diagnostic);
}

export function duplicateLiteratureNoteWarning(
  notes: readonly Pick<TFile, "path">[],
): string | null {
  if (notes.length < 2) return null;
  return m.notice_duplicate_literature_notes({
    paths: notes.map((file) => file.path).join(", "),
    selected: notes[0]!.path,
  });
}

export function resolveLiteratureNoteWithWarning(
  notes: readonly TFile[],
): TFile | undefined {
  const warning = duplicateLiteratureNoteWarning(notes);
  if (warning) new BaseNotice(warning);
  return notes[0];
}
