import { distinct } from "@std/collections";
// Batch import runner for Zotero notes into standalone Markdown mirrors.
import { type TFile } from "obsidian";

import {
  getChildNotesByParentIDs,
  getItemDisplayRefByID,
  getItemsByKey,
  getNoteByItemID,
  getNoteByKey,
  getNoteRefsByItemIDs,
  type ChildNote,
  type GroupIDMemo,
} from "@zotlit/db";
import { type ImportMode } from "@zotlit/protocol";

import { confirm } from "@/lib/confirm";
import { getLogger } from "@/lib/log";
import * as m from "@/paraglide/messages";
import { type DatabaseService } from "@/services/database/service";
import {
  resolveIndexedKeyLibrary,
  type NoteFeatureContext,
} from "@/services/note-feature/context";
import { buildAnnotationParagraphsRenderer } from "@/services/note-feature/operations";
import { type NoteIndex } from "@/services/note-index/service";
import { type SettingsService } from "@/services/settings/service";
import {
  BatchModal,
  type BatchClassifyControls,
  type BatchRunControls,
  type BatchRunResult,
  classifyChunked,
  executeBatchRun,
  FlatManifest,
  type FlatTask,
  HierarchyManifest,
  type HierarchyParent,
} from "@/views/batch-modal";

import { type NoteImportService, type WriteOutcome } from "./service";

const logger = getLogger("batch-import");

/** Bounds concurrent per-note loads + writes during a modal run, so Cancel can
 * abort the queued remainder between items. */
const IMPORT_CONCURRENCY = 16;

export interface NoteImportContext {
  db: DatabaseService;
  settings: SettingsService;
  noteImport: NoteImportService;
  noteIndex: NoteIndex;
  noteFeatures: NoteFeatureContext;
}

type ImportAction =
  | { note: ChildNote; label: string; kind: "create" }
  | { note: ChildNote; label: string; kind: "overwrite"; file: TFile };

interface NotFoundEntry {
  itemID: number;
  label: string;
}

/**
 * Preflight outcomes the caller maps to a notice; the interactive paths own
 * their own feedback. `batch-modal` means a confirm/progress modal is now
 * driving the work (it surfaces its own summary). `single` carries the lone
 * note's write outcome + title for the toast; `cancelled` is the declined
 * single-note overwrite confirm.
 */
export type BatchImportResult =
  | { outcome: "db-unavailable" }
  | { outcome: "empty-selection" }
  | { outcome: "not-found"; count: number }
  | { outcome: "batch-modal" }
  | { outcome: "single"; write: WriteOutcome; title: string }
  | { outcome: "cancelled" };

/**
 * Explicitly import notes by `itemIDs`, routing on mode + count (mirrors
 * {@link runBatchUpdate}):
 *
 * - `mode="child"` — always open the {@link HierarchyManifest} modal; its
 *   loading phase expands each lit item's child notes.
 * - `mode="note"`, 1 id — no modal: create imports + toasts, overwrite confirms
 *   first (an unattended single-key trigger shouldn't silently clobber).
 * - `mode="note"`, ≥2 ids — open the {@link FlatManifest} modal.
 *
 * Returns a preflight {@link BatchImportResult}; modal/single paths surface their
 * own feedback, so the caller only notices the early-exit outcomes.
 */
export async function runBatchImport(
  deps: NoteImportContext,
  mode: ImportMode,
  itemIDs: readonly number[],
): Promise<BatchImportResult> {
  if (deps.db.state !== "ready") {
    logger.warn("Batch import: database not ready", { count: itemIDs.length });
    return { outcome: "db-unavailable" };
  }
  if (itemIDs.length === 0) {
    return { outcome: "empty-selection" };
  }

  await deps.noteIndex.whenIndexed();

  if (mode === "child") {
    openChildImportModal(deps, itemIDs);
    return { outcome: "batch-modal" };
  }
  if (itemIDs.length === 1) {
    return importSingleNote(deps, itemIDs[0]!);
  }
  openNoteImportModal(deps, itemIDs);
  return { outcome: "batch-modal" };
}

/** Light row label for a note ref: its title, else a key fallback. */
function noteLabel(note: ChildNote): string {
  return note.title?.trim() || m.batch_update_untitled({ id: note.itemID });
}

/** Classify a single note ref into a create/overwrite action against the index. */
function toAction(noteIndex: NoteIndex, note: ChildNote): ImportAction {
  const label = noteLabel(note);
  const existing = noteIndex.getImportedNoteByNoteKey(note.indexedKey)[0];
  if (existing) return { note, label, kind: "overwrite", file: existing };
  return { note, label, kind: "create" };
}

function actionToTask(action: ImportAction): FlatTask {
  return { id: action.note.itemID, label: action.label, kind: action.kind };
}

// ---------------------------------------------------------------------------
// Modal: note mode (≥2)
// ---------------------------------------------------------------------------

function openNoteImportModal(
  deps: NoteImportContext,
  itemIDs: readonly number[],
): void {
  const ids = distinct(itemIDs);
  let actions: ImportAction[] = [];
  let notFoundCount = 0;
  new BatchModal(deps.noteFeatures.app, {
    text: {
      title: m.batch_import_title(),
      loadingLabel: m.batch_import_loading_label(),
      loadFailed: m.batch_import_load_failed(),
      runFailed: m.batch_import_run_failed(),
      progressLabel: m.batch_import_loading(),
      confirmIntro: ({ actionable, notFound }) =>
        actionable === 0
          ? m.batch_import_confirm_none({ count: notFound })
          : m.batch_import_confirm_intro({ count: actionable }),
      confirmButton: m.batch_import_confirm_button(),
      runSummary: importRunSummary(() => notFoundCount),
    },
    total: ids.length,
    onClassify: async (controls) => {
      const classified = await classifyNoteImport(deps, ids, controls);
      actions = classified.actions;
      notFoundCount = classified.notFound.length;
      return new FlatManifest({
        tasks: actions.map(actionToTask),
        notFound: classified.notFound,
        groups: [
          { kind: "create", header: m.batch_import_group_import },
          { kind: "overwrite", header: m.batch_import_group_overwrite },
        ],
        notFoundHeader: m.batch_update_group_not_found,
        skippedHeader: m.batch_update_group_skipped,
        abortedHeader: m.batch_update_group_aborted,
      });
    },
    onRun: (controls) => executeImportRun(deps, actions, controls),
  }).open();
}

/**
 * Resolve note `itemIDs` into create/overwrite actions, chunked so the
 * synchronous per-id queries yield between slices (the one UI-freeze risk).
 * Ids that don't resolve to a note land in `notFound`.
 *
 * @throws when {@link BatchClassifyControls.signal} aborts.
 */
async function classifyNoteImport(
  deps: NoteImportContext,
  itemIDs: readonly number[],
  controls: BatchClassifyControls,
): Promise<{ actions: ImportAction[]; notFound: NotFoundEntry[] }> {
  using lease = await deps.db.acquireRead();
  const client = lease.client;
  const memo: GroupIDMemo = new Map();
  const actions: ImportAction[] = [];
  const notFound: NotFoundEntry[] = [];
  await classifyChunked(itemIDs, controls, (slice) => {
    const refs = getNoteRefsByItemIDs(client, slice, { memo });
    const resolved = new Set(refs.map((ref) => ref.itemID));
    for (const ref of refs) actions.push(toAction(deps.noteIndex, ref));
    for (const id of slice) {
      if (!resolved.has(id)) {
        notFound.push({
          itemID: id,
          label: m.batch_import_item_not_note({ id }),
        });
      }
    }
  });
  logClassified("note", actions, {
    total: itemIDs.length,
    notFound: notFound.length,
  });
  return { actions, notFound };
}

// ---------------------------------------------------------------------------
// Modal: child mode (always)
// ---------------------------------------------------------------------------

function openChildImportModal(
  deps: NoteImportContext,
  parentItemIDs: readonly number[],
): void {
  const ids = distinct(parentItemIDs);
  let actions: ImportAction[] = [];
  new BatchModal(deps.noteFeatures.app, {
    text: {
      title: m.batch_import_child_title(),
      loadingLabel: m.batch_import_loading_label(),
      loadFailed: m.batch_import_load_failed(),
      runFailed: m.batch_import_run_failed(),
      progressLabel: m.batch_import_loading(),
      confirmIntro: ({ actionable }) =>
        actionable === 0
          ? m.batch_import_child_confirm_none()
          : m.batch_import_child_confirm_intro({ count: actionable }),
      confirmButton: m.batch_import_confirm_button(),
      runSummary: importRunSummary(() => 0),
    },
    total: ids.length,
    onClassify: async (controls) => {
      const parents = await classifyChildImport(deps, ids, controls);
      actions = parents.flatMap((parent) => parent.actions);
      return new HierarchyManifest({
        parents: parents.map(
          (parent): HierarchyParent => ({
            label: parent.label,
            children: parent.actions.map(actionToTask),
          }),
        ),
        doneHeader: m.batch_import_child_group_done,
        skippedHeader: m.batch_update_group_skipped,
        abortedHeader: m.batch_update_group_aborted,
      });
    },
    onRun: (controls) => executeImportRun(deps, actions, controls),
  }).open();
}

interface ChildGroup {
  label: string;
  actions: ImportAction[];
}

/**
 * Expand each lit item into its child notes, chunked over parents. Parents with
 * no child notes are dropped; the modal's empty confirm state then reports
 * "no child notes to import".
 *
 * @throws when {@link BatchClassifyControls.signal} aborts.
 */
async function classifyChildImport(
  deps: NoteImportContext,
  parentItemIDs: readonly number[],
  controls: BatchClassifyControls,
): Promise<ChildGroup[]> {
  using lease = await deps.db.acquireRead();
  const client = lease.client;
  const memo: GroupIDMemo = new Map();
  const parents: ChildGroup[] = [];
  await classifyChunked(parentItemIDs, controls, (slice) => {
    for (const parentID of slice) {
      const children = getChildNotesByParentIDs(client, [parentID], { memo });
      if (children.length === 0) continue;
      const display = getItemDisplayRefByID(client, parentID, { memo });
      const label =
        display?.title?.trim() || m.batch_update_untitled({ id: parentID });
      parents.push({
        label,
        actions: children.map((child) => toAction(deps.noteIndex, child)),
      });
    }
  });
  const childActions = parents.flatMap((parent) => parent.actions);
  logClassified("child", childActions, {
    total: parentItemIDs.length,
    notFound: 0,
  });
  return parents;
}

// ---------------------------------------------------------------------------
// Single note (mode=note, 1 id)
// ---------------------------------------------------------------------------

async function importSingleNote(
  deps: NoteImportContext,
  itemID: number,
): Promise<BatchImportResult> {
  let ref: ChildNote | undefined;
  {
    using lease = await deps.db.acquireRead();
    ref = getNoteRefsByItemIDs(lease.client, [itemID])[0];
  }
  if (!ref) return { outcome: "not-found", count: 1 };

  const title = noteLabel(ref);
  const existing = deps.noteIndex.getImportedNoteByNoteKey(ref.indexedKey)[0];
  if (existing) {
    const yes = await confirm(
      {
        title: m.modal_import_overwrite_title(),
        content: m.modal_import_overwrite_desc({ title }),
        action: m.modal_import_overwrite_confirm(),
        destructive: true,
      },
      deps.noteFeatures.app,
    );
    if (!yes) return { outcome: "cancelled" };
  }

  const write = await importOne(deps, ref, existing);
  return { outcome: "single", write, title };
}

/** Load a note's full body under a fresh lease and write its mirror. */
async function importOne(
  deps: NoteImportContext,
  ref: ChildNote,
  targetFile: TFile | undefined,
): Promise<WriteOutcome> {
  const [settings] = await Promise.all([
    deps.settings.loaded,
    deps.noteFeatures.template.ready,
  ]);
  using lease = await deps.db.acquireRead();
  const memo: GroupIDMemo = new Map();
  const note = getNoteByItemID(lease.client, ref.itemID, { memo });
  if (!note) return "skipped";
  const renderAnnotationParagraph = buildAnnotationParagraphsRenderer(
    deps.noteFeatures,
    {
      client: lease.client,
      libraryID: note.libraryID,
      settings,
      groupIdMemo: memo,
    },
  );
  const folder = await deps.noteImport.ensureImportFolder(settings);
  return deps.noteImport.importNote(note, {
    client: lease.client,
    settings,
    renderAnnotationParagraph,
    folder,
    ...(targetFile ? { targetFile } : {}),
  });
}

// ---------------------------------------------------------------------------
// Shared run executor (modal onRun)
// ---------------------------------------------------------------------------

/**
 * Execute classified import actions, reporting per-item settle events for the
 * modal's progress bar. Each task loads its own full note (deferred from
 * classification) then writes; a note deleted between classify and its write
 * settles as skipped. Cancel aborts the queued remainder while in-flight writes
 * finish.
 */
async function executeImportRun(
  deps: NoteImportContext,
  actions: readonly ImportAction[],
  controls: BatchRunControls,
): Promise<BatchRunResult> {
  const [settings] = await Promise.all([
    deps.settings.loaded,
    deps.noteFeatures.template.ready,
  ]);
  using lease = await deps.db.acquireRead();
  const client = lease.client;
  const memo: GroupIDMemo = new Map();
  const folder = await deps.noteImport.ensureImportFolder(settings);
  let created = 0;
  let updated = 0;
  let skipped = 0;

  const { failed, cancelled } = await executeBatchRun({
    tasks: actions.map((a) => ({ ...a, id: a.note.itemID })),
    controls,
    concurrency: IMPORT_CONCURRENCY,
    run: async (task) => {
      const note = getNoteByItemID(client, task.note.itemID, { memo });
      if (!note) {
        logger.warn("Imported note vanished before import; skipped", {
          noteKey: task.note.indexedKey,
        });
        skipped += 1;
        return "skipped";
      }
      const renderAnnotationParagraph = buildAnnotationParagraphsRenderer(
        deps.noteFeatures,
        { client, libraryID: note.libraryID, settings, groupIdMemo: memo },
      );
      const outcome = await deps.noteImport.importNote(note, {
        client,
        settings,
        renderAnnotationParagraph,
        folder,
        ...(task.kind === "overwrite" ? { targetFile: task.file } : {}),
      });
      if (outcome === "created") created += 1;
      else if (outcome === "overwritten") updated += 1;
      else skipped += 1;
      return "done";
    },
    onTaskFailed: (task, error) => {
      logger.warn("Batch import item failed", {
        noteKey: task.note.indexedKey,
        error,
      });
    },
  });

  const total = actions.length;
  logger.info("Batch import finished", {
    created,
    updated,
    skipped,
    failed,
    cancelled,
    total,
  });
  return { created, updated, skipped, failed, cancelled };
}

/** Build the run-summary copy; `notFound` is captured from classification. */
function importRunSummary(
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

function logClassified(
  mode: ImportMode,
  actions: readonly ImportAction[],
  counts: { total: number; notFound: number },
): void {
  logger.info("Batch import classified", () => {
    const { create = [], overwrite = [] } = Object.groupBy(
      actions,
      (a) => a.kind,
    );
    return {
      mode,
      total: counts.total,
      create: create.length,
      overwrite: overwrite.length,
      notFound: counts.notFound,
    };
  });
}

/**
 * Resolve an `indexedKey` (from frontmatter) to a parent item's `itemID`, then
 * run a `"child"` batch import. Returns a database-unavailable outcome when
 * the database is closed, or `null` when the key doesn't resolve to a live item.
 */
export async function runChildImportByKey(
  deps: NoteImportContext,
  indexedKey: string,
): Promise<BatchImportResult | null> {
  if (deps.db.state !== "ready") {
    logger.warn("Child-note import: database not ready", { indexedKey });
    return { outcome: "db-unavailable" };
  }
  const resolved = resolveIndexedKeyLibrary(deps.db.client, indexedKey);
  const itemID = resolved
    ? getItemsByKey(deps.db.client, resolved.libraryID, [resolved.key])[0]
        ?.itemID
    : undefined;
  if (itemID == null) return null;
  return runBatchImport(deps, "child", [itemID]);
}

export type ReimportResult =
  | { outcome: "db-unavailable" }
  | { outcome: "not-found" }
  | { outcome: WriteOutcome };

/**
 * Re-import a single note identified by its `indexedKey`. Resolves the note
 * from the database, then writes/overwrites the imported mirror file.
 */
export async function reimportNoteByKey(
  deps: NoteImportContext,
  noteKey: string,
  targetFile: TFile,
): Promise<ReimportResult> {
  if (deps.db.state !== "ready") {
    logger.warn("Imported note reimport: database not ready", { noteKey });
    return { outcome: "db-unavailable" };
  }

  await Promise.all([
    deps.noteIndex.whenIndexed(),
    deps.noteFeatures.template.ready,
  ]);

  using lease = await deps.db.acquireRead();
  const resolved = resolveIndexedKeyLibrary(lease.client, noteKey);
  const note = resolved
    ? getNoteByKey(lease.client, resolved.key, resolved.libraryID)
    : null;
  if (!note) return { outcome: "not-found" };

  const groupIdMemo: GroupIDMemo = new Map();
  const settings = await deps.settings.loaded;
  const renderAnnotationParagraph = buildAnnotationParagraphsRenderer(
    deps.noteFeatures,
    { client: lease.client, libraryID: note.libraryID, settings, groupIdMemo },
  );
  const folder = await deps.noteImport.ensureImportFolder(settings);

  const writeOutcome = await deps.noteImport.importNote(note, {
    client: lease.client,
    settings,
    renderAnnotationParagraph,
    folder,
    targetFile,
  });
  return { outcome: writeOutcome };
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

export function batchImportToast(): {
  success: (result: BatchImportResult) => string | undefined;
  error: string;
} {
  return {
    success: batchImportNotice,
    error: m.batch_import_failed(),
  };
}

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
