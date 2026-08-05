import { distinct } from "@std/collections";
// Batch import runner for Zotero notes into standalone Markdown mirrors.
import { type MetadataCache, type TFile } from "obsidian";

import {
  getChildNotesByParentIDs,
  getItemDisplayRefByID,
  getItemsByKey,
  getNoteByItemID,
  getNoteByKey,
  getNoteRefsByItemIDs,
  getTrashedNoteItemIDs,
  resolveIndexedKeyLibrary,
  type ChildNote,
  type GroupIDMemo,
  type TagMemo,
} from "@zotlit/db";
import { type ImportMode } from "@zotlit/protocol";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import {
  type BatchClassifyControls,
  type BatchRunControls,
  type BatchRunResult,
  classifyChunked,
  runBatchWrite,
} from "@/services/batch-run";
import {
  resolveBatchScope,
  type BatchScopeOptions,
} from "@/services/batch-scope";
import { type DatabaseService } from "@/services/database/service";
import { lastmodFromFrontmatter } from "@/services/note-index/parse";
import { type NoteIndex } from "@/services/note-index/service";
import { type SettingsService } from "@/services/settings/service";
import { type TemplateService } from "@/services/template/service";
import {
  FlatManifest,
  type FlatTask,
  HierarchyManifest,
  type HierarchyParent,
} from "@/views/batch-modal";

import { importRunSummary } from "./batch-import-notices";
import { type NoteImporter, type WriteOutcome } from "./service";
import { type NoteImportView } from "./view";

const logger = getLogger("batch-import");

/** Bounds concurrent per-note loads + writes during a modal run, so Cancel can
 * abort the queued remainder between items. */
const IMPORT_CONCURRENCY = 16;

export interface NoteImportDeps {
  /** UI port for the classify/confirm modals; keeps `App` out of the runners. */
  view: NoteImportView;
  db: Pick<DatabaseService, "state" | "client" | "acquireRead">;
  settings: Pick<SettingsService, "loaded">;
  noteImport: Pick<NoteImporter, "importNote">;
  noteIndex: Pick<NoteIndex, "whenIndexed" | "getImportedNoteByNoteKey">;
  metadataCache: Pick<MetadataCache, "getFileCache">;
  /** Only template readiness is gated here; rendering lives in `noteImport`. */
  template: Pick<TemplateService, "ready">;
}

/**
 * The note-import command surface: the interactive batch/single/child import
 * routing bound to one dependency set. Built once (see {@link createBatchImport})
 * so consumers hold this seam instead of the full dependency context.
 */
export interface BatchImport {
  /** @see {@link runBatchImport} */
  runBatchImport(
    mode: ImportMode,
    itemIDs: readonly number[],
  ): Promise<BatchImportResult>;
  /** @see {@link runBatchImportAll} */
  runBatchImportAll(opts?: BatchScopeOptions): Promise<BatchImportResult>;
  /** @see {@link runChildImportByKey} */
  runChildImportByKey(indexedKey: string): Promise<BatchImportResult | null>;
  /** @see {@link reimportNoteByKey} */
  reimportNoteByKey(
    noteKey: string,
    targetFile: TFile,
  ): Promise<ReimportResult>;
}

export function createBatchImport(deps: NoteImportDeps): BatchImport {
  return {
    runBatchImport: (mode, itemIDs) => runBatchImport(deps, mode, itemIDs),
    runBatchImportAll: (opts) => runBatchImportAll(deps, opts),
    runChildImportByKey: (indexedKey) => runChildImportByKey(deps, indexedKey),
    reimportNoteByKey: (noteKey, targetFile) =>
      reimportNoteByKey(deps, noteKey, targetFile),
  };
}

type ImportAction =
  | { note: ChildNote; label: string; kind: "create" }
  | { note: ChildNote; label: string; kind: "overwrite"; file: TFile }
  | { note: ChildNote; label: string; kind: "up-to-date"; file: TFile };

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
  | { outcome: "library-mismatch" }
  | { outcome: "collection-not-found" }
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
async function runBatchImport(
  deps: NoteImportDeps,
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

/**
 * Import every Zotero note in scope — the whole configured citation library, or
 * one collection and its descendants. Both note kinds are gathered: the child
 * notes of the regular items in scope and the standalone notes filed there. The
 * resolved notes then run through the same flow as an explicit `mode="note"`
 * import, so the user still confirms in the batch modal before anything writes.
 *
 * @param opts.expectedGroupID when set, the configured library's group ID must
 *   match — `0` means the personal library, a positive integer names a group.
 *   A mismatch returns `library-mismatch` without scanning.
 * @param opts.collectionKey when set, narrows the run to that collection and
 *   every collection nested under it. A key this database doesn't hold returns
 *   `collection-not-found`.
 */
async function runBatchImportAll(
  deps: NoteImportDeps,
  opts?: BatchScopeOptions,
): Promise<BatchImportResult> {
  if (deps.db.state !== "ready") {
    logger.warn("Batch import all: database not ready");
    return { outcome: "db-unavailable" };
  }

  const settings = await deps.settings.loaded;

  let noteItemIDs: readonly number[];
  {
    using lease = await deps.db.acquireRead();
    const scope = resolveBatchScope(lease.client, "notes", {
      libraryID: settings["zotero.citation-library"],
      ...opts,
    });
    if (scope.outcome !== "resolved") {
      return { outcome: scope.outcome };
    }
    noteItemIDs = scope.itemIDs;
  }

  logger.info("Batch import all resolved", {
    collectionKey: opts?.collectionKey,
    notes: noteItemIDs.length,
  });
  return runBatchImport(deps, "note", noteItemIDs);
}

/** Light row label for a note ref: its title, else a key fallback. */
function noteLabel(note: ChildNote): string {
  return note.title?.trim() || m.batch_update_untitled({ id: note.itemID });
}

/** Existing file with matching `zotero-lastmod` → up-to-date; missing field → overwrite. */
function toAction(
  deps: Pick<NoteImportDeps, "noteIndex" | "metadataCache">,
  note: ChildNote,
): ImportAction {
  const label = noteLabel(note);
  const existing = deps.noteIndex.getImportedNoteByNoteKey(note.indexedKey)[0];
  if (!existing) return { note, label, kind: "create" };

  const stored = lastmodFromFrontmatter(
    deps.metadataCache.getFileCache(existing),
  );
  const storedSec = stored && Math.trunc(stored.epochMilliseconds / 1000);
  const liveSec = Math.trunc(note.dateModified.epochMilliseconds / 1000);
  if (storedSec === liveSec) {
    return { note, label, kind: "up-to-date", file: existing };
  }
  return { note, label, kind: "overwrite", file: existing };
}

function actionToTask(action: ImportAction): FlatTask {
  return { id: action.note.itemID, label: action.label, kind: action.kind };
}

function needsImport(action: ImportAction): boolean {
  return action.kind !== "up-to-date";
}

// ---------------------------------------------------------------------------
// Modal: note mode (≥2)
// ---------------------------------------------------------------------------

function openNoteImportModal(
  deps: NoteImportDeps,
  itemIDs: readonly number[],
): void {
  const ids = distinct(itemIDs);
  let runnableActions: ImportAction[] = [];
  let notFoundCount = 0;
  deps.view.openBatchModal({
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
      runnableActions = classified.actions.filter(needsImport);
      const upToDate = classified.actions.filter((a) => !needsImport(a));
      notFoundCount = classified.notFound.length;
      return new FlatManifest({
        tasks: runnableActions.map(actionToTask),
        notFound: classified.notFound,
        groups: [
          { kind: "create", header: m.batch_import_group_import },
          { kind: "overwrite", header: m.batch_import_group_overwrite },
        ],
        upToDate: upToDate.map((a) => ({ label: a.label })),
        upToDateHeader: m.batch_import_group_up_to_date,
        notFoundHeader: m.batch_update_group_not_found,
        skippedHeader: m.batch_update_group_skipped,
        abortedHeader: m.batch_update_group_aborted,
      });
    },
    onRun: (controls) => executeImportRun(deps, runnableActions, controls),
  });
}

/**
 * Resolve note `itemIDs` into create/overwrite actions, chunked so the
 * synchronous per-id queries yield between slices (the one UI-freeze risk).
 * Ids that don't resolve to a note land in `notFound`.
 *
 * @throws when {@link BatchClassifyControls.signal} aborts.
 */
async function classifyNoteImport(
  deps: NoteImportDeps,
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
    for (const ref of refs) actions.push(toAction(deps, ref));
    const unresolved = slice.filter((id) => !resolved.has(id));
    const trashed = getTrashedNoteItemIDs(client, unresolved);
    for (const id of unresolved) {
      notFound.push({
        itemID: id,
        label: trashed.has(id)
          ? m.batch_import_item_trashed({ id })
          : m.batch_import_item_not_note({ id }),
      });
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
  deps: NoteImportDeps,
  parentItemIDs: readonly number[],
): void {
  const ids = distinct(parentItemIDs);
  let runnableActions: ImportAction[] = [];
  deps.view.openBatchModal({
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
      const allActions = parents.flatMap((parent) => parent.actions);
      runnableActions = allActions.filter(needsImport);
      const upToDateChildren = allActions.filter((a) => !needsImport(a));
      return new HierarchyManifest({
        parents: parents.map(
          (parent): HierarchyParent => ({
            label: parent.label,
            children: parent.actions.filter(needsImport).map(actionToTask),
          }),
        ),
        upToDate: upToDateChildren.map((a) => ({ label: a.label })),
        upToDateHeader: m.batch_import_group_up_to_date,
        doneHeader: m.batch_import_child_group_done,
        skippedHeader: m.batch_update_group_skipped,
        abortedHeader: m.batch_update_group_aborted,
      });
    },
    onRun: (controls) => executeImportRun(deps, runnableActions, controls),
  });
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
  deps: NoteImportDeps,
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
        actions: children.map((child) => toAction(deps, child)),
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
  deps: NoteImportDeps,
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
    const yes = await deps.view.confirm({
      title: m.modal_import_overwrite_title(),
      content: m.modal_import_overwrite_desc({ title }),
      action: m.modal_import_overwrite_confirm(),
      destructive: true,
    });
    if (!yes) return { outcome: "cancelled" };
  }

  const write = await importOne(deps, ref, existing);
  return { outcome: "single", write, title };
}

/** Load a note's full body under a fresh lease and write its mirror. */
async function importOne(
  deps: NoteImportDeps,
  ref: ChildNote,
  targetFile: TFile | undefined,
): Promise<WriteOutcome> {
  const [settings] = await Promise.all([
    deps.settings.loaded,
    deps.template.ready,
  ]);
  using lease = await deps.db.acquireRead();
  const memo: GroupIDMemo = new Map();
  const note = getNoteByItemID(lease.client, ref.itemID, { memo });
  if (!note) return "skipped";
  return deps.noteImport.importNote(note, {
    client: lease.client,
    settings,
    groupIdMemo: memo,
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
  deps: NoteImportDeps,
  actions: readonly ImportAction[],
  controls: BatchRunControls,
): Promise<BatchRunResult> {
  const [settings] = await Promise.all([
    deps.settings.loaded,
    deps.template.ready,
  ]);
  const memo: GroupIDMemo = new Map();
  const tagMemo: TagMemo = new Map();
  const attachmentFolderCache = new Map<string, string>();

  const result = await runBatchWrite({
    db: deps.db,
    tasks: actions.map((a) => ({ ...a, id: a.note.itemID })),
    controls,
    concurrency: IMPORT_CONCURRENCY,
    run: async (task, client) => {
      const note = getNoteByItemID(client, task.note.itemID, { memo });
      if (!note) {
        logger.warn("Imported note vanished before import; skipped", {
          noteKey: task.note.indexedKey,
        });
        return "skipped";
      }
      const outcome = await deps.noteImport.importNote(note, {
        client,
        settings,
        groupIdMemo: memo,
        tagMemo,
        attachmentFolderCache,
        ...(task.kind === "overwrite" ? { targetFile: task.file } : {}),
      });
      if (outcome === "overwritten") return "updated";
      return outcome;
    },
    onTaskFailed: (task, error) => {
      logger.warn("Batch import item failed", {
        noteKey: task.note.indexedKey,
        error,
      });
    },
  });

  logger.info("Batch import finished", {
    ...result,
    total: actions.length,
  });
  return result;
}

function logClassified(
  mode: ImportMode,
  actions: readonly ImportAction[],
  counts: { total: number; notFound: number },
): void {
  logger.info("Batch import classified", () => {
    const grouped = Object.groupBy(actions, (a) => a.kind);
    return {
      mode,
      total: counts.total,
      create: (grouped.create ?? []).length,
      overwrite: (grouped.overwrite ?? []).length,
      "up-to-date": (grouped["up-to-date"] ?? []).length,
      notFound: counts.notFound,
    };
  });
}

/**
 * Resolve an `indexedKey` (from frontmatter) to a parent item's `itemID`, then
 * run a `"child"` batch import. Returns a database-unavailable outcome when
 * the database is closed, or `null` when the key doesn't resolve to a live item.
 */
async function runChildImportByKey(
  deps: NoteImportDeps,
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
async function reimportNoteByKey(
  deps: NoteImportDeps,
  noteKey: string,
  targetFile: TFile,
): Promise<ReimportResult> {
  if (deps.db.state !== "ready") {
    logger.warn("Imported note reimport: database not ready", { noteKey });
    return { outcome: "db-unavailable" };
  }

  await Promise.all([deps.noteIndex.whenIndexed(), deps.template.ready]);

  using lease = await deps.db.acquireRead();
  const groupIdMemo: GroupIDMemo = new Map();
  const resolved = resolveIndexedKeyLibrary(lease.client, noteKey);
  const note = resolved
    ? getNoteByKey(lease.client, resolved.key, {
        libraryID: resolved.libraryID,
        memo: groupIdMemo,
      })
    : null;
  if (!note) return { outcome: "not-found" };

  const settings = await deps.settings.loaded;
  const writeOutcome = await deps.noteImport.importNote(note, {
    client: lease.client,
    settings,
    groupIdMemo,
    targetFile,
  });
  return { outcome: writeOutcome };
}
