// Batch import runner for Zotero notes into standalone Markdown mirrors.
import { distinct } from "@std/collections";
import { Cause, Effect, Stream } from "effect";
import type { TFile } from "obsidian";

import { parseIndexedKey, USER_LIBRARY_ID } from "@zotlit/db";
import type { ChildNote, Note } from "@zotlit/db";
import type { ImportMode } from "@zotlit/protocol";

import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { DEFAULT_PROFILE } from "@/lib/profile-stamp";
import { batchProfileSummary } from "@/services/batch-profile-summary";
import type { BatchProfileCount } from "@/services/batch-profile-summary";
import {
  classifyStream,
  executeBatchRun,
  runBatchWith,
} from "@/services/batch-run";
import type {
  BatchClassifyControls,
  BatchRunControls,
  RunOutcome,
} from "@/services/batch-run";
import {
  batchGroupKey,
  batchGroups,
  batchLibraries,
  planBatchScope,
  withUnavailableLibraries,
} from "@/services/batch-scope";
import type { BatchLibrary, BatchTarget } from "@/services/batch-scope";
import { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import { collectExcerptSummary } from "@/services/excerpt-image/prepare";
import type { LibraryScope } from "@/services/library-scope/service";
import type {
  NoteFeature,
  CreationProfileSelection,
  ProfilePreview,
} from "@/services/note-feature";
import { lastmodFromFrontmatter } from "@/services/note-index/parse";
import { NoteIndex } from "@/services/note-index/service";
import { Profile } from "@/services/profile/service";
import { PluginSettings } from "@/services/settings/service";
import { profileRead } from "@/services/template-workbench/sync-template";
import { readDisplayRef } from "@/services/zotero-reads/display-ref";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";
import { FlatManifest, HierarchyManifest } from "@/views/batch-modal";
import type {
  FlatTask,
  HierarchyParent,
  BatchProfileChoice,
} from "@/views/batch-modal";

import { importRunSummary } from "./batch-import-notices";
import { NoteImporter } from "./service";
import type { PreparedExplicitImport, WriteOutcome } from "./service";
import type { NoteImportView } from "./view";

const logged = withLogCategory("batch-import");

/** Bounds concurrent per-note loads + writes during a modal run, so Cancel can
 * stop the queued remainder between items. */
const IMPORT_CONCURRENCY = 16;

/** The services a batch import reads through their tags. */
export type BatchImportServices =
  | LibraryScope
  | MetadataCache
  | NoteImporter
  | NoteIndex
  | PluginSettings
  | Profile
  | ZoteroReads;

/**
 * The legacy values a batch import calls: the UI port for the classify,
 * confirm and Profile modals, and Note Feature's creation Profile and excerpt
 * report. Note Feature converts in a later slice.
 */
export interface BatchImportPorts {
  /** UI port for the classify/confirm modals; keeps `App` out of the runners. */
  readonly view: NoteImportView;
  readonly noteFeature: Pick<
    NoteFeature,
    "resolveCreationProfile" | "reportExcerptImages"
  >;
}

/**
 * The note-import command surface for callers outside Effect: the
 * interactive batch/single/child import routing. `build.ts` binds it over the
 * plugin's services (`batch-import-handle.ts`).
 */
export interface BatchImport {
  /** @see {@link runBatchImport} */
  runBatchImport(
    mode: ImportMode,
    itemIDs: readonly number[],
  ): Promise<BatchImportResult>;
  /** @see {@link runBatchImportAll} */
  runBatchImportAll(target?: BatchTarget): Promise<BatchImportResult>;
  /** @see {@link runChildImportByKey} */
  runChildImportByKey(indexedKey: string): Promise<BatchImportResult | null>;
  /** @see {@link reimportNoteByKey} */
  reimportNoteByKey(
    noteKey: string,
    targetFile: TFile,
  ): Promise<ReimportResult>;
}

type ImportAction = {
  profilePlan?: PreparedExplicitImport;
  unknownStamp?: string;
  task?: FlatTask;
} & (
  | { note: ChildNote; label: string; kind: "create" }
  | { note: ChildNote; label: string; kind: "overwrite"; file: TFile }
  | { note: ChildNote; label: string; kind: "up-to-date"; file: TFile }
);

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
  | { outcome: "no-library-in-scope" }
  | { outcome: "unavailable-target" }
  | { outcome: "collection-not-found" }
  | { outcome: "not-found"; count: number }
  | { outcome: "batch-modal" }
  | { outcome: "single"; write: WriteOutcome; title: string }
  | { outcome: "cancelled" };

/** Whether the database answers reads now. */
const databaseReady = Effect.gen(function* () {
  return (yield* (yield* ZoteroReads).current).state === "ready";
});

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
 * The count is the flattened total, so a Library Scope expansion reaching one
 * note takes the same single-note path an explicit single id does.
 *
 * Returns a preflight {@link BatchImportResult}; modal/single paths surface their
 * own feedback, so the caller only notices the early-exit outcomes.
 *
 * @param request.unavailableLibraries selected Libraries this database holds no
 *   Library for; stated in the confirmation introduction.
 */
export const runBatchImport = Effect.fn("runBatchImport")(function* (
  ports: BatchImportPorts,
  request: {
    mode: ImportMode;
    itemIDs: readonly number[];
    unavailableLibraries?: number;
  },
) {
  const { mode, itemIDs, unavailableLibraries = 0 } = request;
  if (!(yield* databaseReady)) {
    yield* Effect.logWarning("Batch import: database not ready").pipe(
      Effect.annotateLogs({ count: itemIDs.length }),
      logged,
    );
    return result({ outcome: "db-unavailable" });
  }
  if (itemIDs.length === 0) return result({ outcome: "empty-selection" });

  yield* (yield* NoteIndex).whenIndexed;

  if (mode === "child") {
    yield* openChildImportModal(ports, itemIDs);
    return result({ outcome: "batch-modal" });
  }
  if (itemIDs.length === 1) return yield* importSingleNote(ports, itemIDs[0]!);
  yield* openNoteImportModal(ports, itemIDs, unavailableLibraries);
  return result({ outcome: "batch-modal" });
});

/** `value` as a {@link BatchImportResult}, so each branch returns one type. */
const result = (value: BatchImportResult): BatchImportResult => value;

/**
 * Import every Zotero note a target covers. An exact `target` names one Library,
 * optionally narrowed to one collection; no target expands every available
 * Library of the current Library Scope, in canonical order, under this one
 * planning lease. Both note kinds are gathered: the child notes of the regular
 * items in scope and the standalone notes filed there. The resolved notes then
 * run through the same flow as an explicit `mode="note"` import, so the user
 * still confirms in the batch modal before anything writes.
 *
 * @param target.groupID names the exact Library the run covers — `0` for
 *   My Library, a positive integer for a group. A group this database doesn't
 *   hold returns `unavailable-target` without scanning.
 * @param target.collectionKey narrows the run to that collection of the named
 *   Library and every collection nested under it. A key that Library doesn't
 *   hold returns `collection-not-found`.
 */
export const runBatchImportAll = Effect.fn("runBatchImportAll")(function* (
  ports: BatchImportPorts,
  target: BatchTarget = {},
) {
  if (!(yield* databaseReady)) {
    yield* Effect.logWarning("Batch import all: database not ready").pipe(
      logged,
    );
    return result({ outcome: "db-unavailable" });
  }

  const plan = yield* planBatchScope("notes", target);
  if (plan.outcome !== "resolved") return result({ outcome: plan.outcome });

  yield* Effect.logInfo("Batch import all resolved").pipe(
    Effect.annotateLogs({
      groupID: target.groupID,
      collectionKey: target.collectionKey,
      unavailableLibraries: plan.unavailableLibraries,
      notes: plan.itemIDs.length,
    }),
    logged,
  );
  return yield* runBatchImport(ports, {
    mode: "note",
    itemIDs: plan.itemIDs,
    unavailableLibraries: plan.unavailableLibraries,
  });
});

/** Light row label for a note ref: its title, else a key fallback. */
function noteLabel(note: ChildNote): string {
  return note.title?.trim() || m.batch_update_untitled({ id: note.itemID });
}

/** Existing file with matching `zotero-lastmod` → up-to-date; missing field → overwrite. */
const toAction = Effect.fnUntraced(function* (note: ChildNote) {
  const label = noteLabel(note);
  const existing = (yield* (yield* NoteIndex).getImportedNoteByNoteKey(
    note.indexedKey,
  ))[0];
  if (!existing) {
    const action: ImportAction = { note, label, kind: "create" };
    return action;
  }

  const stored = lastmodFromFrontmatter(
    yield* (yield* MetadataCache).fileCache(existing),
  );
  const storedSec = stored && Math.trunc(stored.epochMilliseconds / 1000);
  const liveSec = Math.trunc(note.dateModified.epochMilliseconds / 1000);
  const action: ImportAction =
    storedSec === liveSec
      ? { note, label, kind: "up-to-date", file: existing }
      : { note, label, kind: "overwrite", file: existing };
  return action;
});

function actionToTask(action: ImportAction): FlatTask {
  const task = {
    id: action.note.itemID,
    label: action.label,
    kind: batchGroupKey(
      action.note.libraryID,
      action.kind === "create" && action.profilePlan?.source === "orphan"
        ? "orphan"
        : action.kind,
    ),
    ...(action.unknownStamp !== undefined
      ? { profile: action.unknownStamp }
      : {}),
    ...(action.profilePlan
      ? {
          profile:
            action.profilePlan.profile.label ??
            m.settings_profile_default_name(),
          ...(action.kind === "create"
            ? { path: action.profilePlan.path }
            : {}),
        }
      : {}),
  };
  action.task = task;
  return task;
}

function needsImport(action: ImportAction): boolean {
  return action.kind !== "up-to-date";
}

function importRow(action: ImportAction): { label: string; profile?: string } {
  return {
    label: action.label,
    ...(action.unknownStamp !== undefined
      ? { profile: action.unknownStamp }
      : {}),
    ...(action.profilePlan
      ? {
          profile:
            action.profilePlan.profile.label ??
            m.settings_profile_default_name(),
        }
      : {}),
  };
}

interface ImportProfileChoice extends BatchProfileChoice {
  readonly selector: ProfileSelector;
}

/**
 * Preview each action's Profile and path, and the orphan Profile choice the
 * confirmation offers. The choice is the modal's edge: its getters and
 * `choose` run on the services this Effect runs with.
 */
const prepareImportProfiles = Effect.fnUntraced(function* (
  ports: BatchImportPorts,
  actions: readonly ImportAction[],
) {
  const importer = yield* NoteImporter;
  const profiles = yield* Profile;
  const zoteroReads = yield* ZoteroReads;
  const context = yield* Effect.context<never>();
  const runSync = Effect.runSyncWith(context);
  const runPromise = Effect.runPromiseWith(context);
  let selection: CreationProfileSelection = yield* Effect.promise(() =>
    ports.noteFeature.resolveCreationProfile(),
  );
  const cache = new Map<ProfileSelector, Map<number, PreparedExplicitImport>>();
  const initial = new Map<number, PreparedExplicitImport>();
  yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* zoteroReads.snapshot;
      for (const action of actions) {
        const unavailable = (error: unknown) =>
          Effect.logDebug(
            "Import preview unavailable; write will report the note diagnostic",
          ).pipe(
            Effect.annotateLogs({ noteKey: action.note.indexedKey, error }),
            logged,
          );
        yield* importer
          .prepareExplicitImport(action.note, {
            reads,
            orphanProfile: selection.selector,
          })
          .pipe(
            Effect.map((plan) => {
              action.profilePlan = plan;
              initial.set(action.note.itemID, plan);
            }),
            Effect.catchTag("NoteImportProfileError", (error) => {
              action.unknownStamp = error.diagnostic.stamp;
              return unavailable(error);
            }),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) => unavailable(Cause.squash(cause)),
            ),
          );
      }
    }),
  );
  cache.set(selection.selector, initial);
  const orphans = actions.filter(
    (action) =>
      action.kind === "create" && action.profilePlan?.source === "orphan",
  );
  const first = orphans[0];
  if (!first) return undefined;

  let indexedKey: string | undefined;
  if (first.note.parentItemID !== null) {
    const parentItemID = first.note.parentItemID;
    indexedKey = (yield* Effect.scoped(
      Effect.gen(function* () {
        const reads = yield* zoteroReads.snapshot;
        return yield* readDisplayRef(reads, parentItemID);
      }),
    ))?.indexedKey;
  }
  const plansFor = Effect.fnUntraced(function* (selector: ProfileSelector) {
    const cached = cache.get(selector);
    if (cached) return cached;
    const plans = new Map<number, PreparedExplicitImport>();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const reads = yield* zoteroReads.snapshot;
        for (const action of orphans) {
          plans.set(
            action.note.itemID,
            yield* importer.prepareExplicitImport(action.note, {
              reads,
              orphanProfile: selector,
            }),
          );
        }
      }),
    );
    cache.set(selector, plans);
    return plans;
  });
  const choose = Effect.fnUntraced(function* () {
    const previews: ProfilePreview[] = [];
    const selectors: ProfileSelector[] = [
      DEFAULT_PROFILE,
      ...(yield* profileRead(profiles.profiles)).map(({ id }) => id),
    ];
    for (const selector of selectors) {
      const plan = (yield* plansFor(selector)).get(first.note.itemID)!;
      previews.push({
        selector,
        label: plan.profile.label,
        folder: plan.profile.bindings["note.import-folder"],
        citationStyle: plan.profile.bindings["citation.references-style"],
        document: plan.profile.document,
        path: plan.path,
      });
    }
    const chosen = yield* Effect.promise(() =>
      ports.view.chooseProfile({ selection, previews, indexedKey }),
    );
    if (chosen === undefined) return;
    const plans = yield* plansFor(chosen);
    for (const action of orphans) {
      action.profilePlan = plans.get(action.note.itemID)!;
      if (action.task)
        Object.assign(action.task, {
          path: action.profilePlan.path,
          profile:
            action.profilePlan.profile.label ??
            m.settings_profile_default_name(),
        });
    }
    selection = { selector: chosen, source: "asked", shouldAsk: true };
    yield* Effect.logDebug("Changed batch orphan Profile").pipe(
      Effect.annotateLogs({ selector: chosen, notes: orphans.length }),
      logged,
    );
  });
  const choice: ImportProfileChoice = {
    get selector() {
      return selection.selector;
    },
    get label() {
      return (
        runSync(profileRead(profiles.resolveProfile(selection.selector)))
          ?.label ?? m.settings_profile_default_name()
      );
    },
    get source() {
      return selection.source;
    },
    choose: () => runPromise(choose()),
  };
  return choice;
});

/**
 * The modal callbacks' runner: an Effect over the services this Effect runs
 * with, settled for a Promise caller as `runBatch` settles it.
 */
const modalRunner = Effect.gen(function* () {
  return runBatchWith(yield* Effect.context<BatchImportServices>());
});

// ---------------------------------------------------------------------------
// Modal: note mode (≥2)
// ---------------------------------------------------------------------------

const openNoteImportModal = Effect.fnUntraced(function* (
  ports: BatchImportPorts,
  itemIDs: readonly number[],
  unavailableLibraries: number,
) {
  const run = yield* modalRunner;
  const profiles = yield* Profile;
  const ids = distinct(itemIDs);
  let runnableActions: ImportAction[] = [];
  let notFoundCount = 0;
  let profileChoice: ImportProfileChoice | undefined;
  let profilesEnabled = false;
  const profileCounts = new Map<ProfileSelector, BatchProfileCount>();
  const classify = Effect.fnUntraced(function* (
    controls: BatchClassifyControls,
  ) {
    const classified = yield* classifyNoteImport(ids, controls);
    profilesEnabled = (yield* profileRead(profiles.profiles)).length > 0;
    if (profilesEnabled)
      profileChoice = yield* prepareImportProfiles(ports, classified.actions);
    runnableActions = classified.actions.filter(needsImport);
    const upToDate = classified.actions.filter((a) => !needsImport(a));
    notFoundCount = classified.notFound.length;
    return new FlatManifest({
      tasks: runnableActions.map(actionToTask),
      notFound: classified.notFound,
      groups: batchGroups(classified.libraries, [
        { kind: "create", header: m.batch_import_group_import },
        ...(profileChoice
          ? [
              {
                kind: "orphan",
                header: m.batch_import_group_orphan,
                profileChoice,
              },
            ]
          : []),
        { kind: "overwrite", header: m.batch_import_group_overwrite },
      ]),
      upToDate: upToDate.map(importRow),
      upToDateHeader: m.batch_import_group_up_to_date,
      notFoundHeader: m.batch_update_group_not_found,
      skippedHeader: m.batch_update_group_skipped,
      abortedHeader: m.batch_update_group_aborted,
    });
  });
  yield* Effect.sync(() =>
    ports.view.openBatchModal({
      text: {
        title: m.batch_import_title(),
        loadingLabel: m.batch_import_loading_label(),
        loadFailed: m.batch_import_load_failed(),
        runFailed: m.batch_import_run_failed(),
        progressLabel: m.batch_import_loading(),
        confirmIntro: ({ actionable, notFound }) =>
          withUnavailableLibraries(
            actionable === 0
              ? m.batch_import_confirm_none({ count: notFound })
              : m.batch_import_confirm_intro({ count: actionable }),
            unavailableLibraries,
          ),
        confirmButton: m.batch_import_confirm_button(),
        runSummary: (result, state) =>
          profilesEnabled
            ? batchProfileSummary(result, {
                ...state,
                profiles: [...profileCounts.values()],
                notFound: notFoundCount,
              })
            : importRunSummary(() => notFoundCount)(result, state),
      },
      total: ids.length,
      // The modal's cancel interrupts the classification.
      onClassify: (controls) => run(classify(controls), controls.signal),
      onRun: (controls) =>
        run(
          executeImportRun(ports, runnableActions, {
            controls,
            profileCounts: profilesEnabled ? profileCounts : undefined,
          }),
        ),
    }),
  );
});

/**
 * Resolve note `itemIDs` into create/overwrite actions from the `NoteRefs`
 * stream, matched against the Note Index here. Each streamed slice advances
 * the loading bar; an interrupt stops the stream. Ids that don't resolve to a
 * note land in `notFound`.
 */
const classifyNoteImport = Effect.fnUntraced(function* (
  itemIDs: readonly number[],
  controls: Pick<BatchClassifyControls, "onProgress">,
) {
  // One Snapshot for the refs and the Libraries they are grouped by.
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const notes: ChildNote[] = [];
      const notFound: NotFoundEntry[] = [];
      yield* classifyStream(
        { itemIDs, read: (ids) => reads.NoteRefs({ itemIDs: ids }) },
        controls,
        (slice) => {
          for (const { note } of slice) if (note) notes.push(note);
          for (const { itemID: id, note, trashed } of slice) {
            if (note) continue;
            notFound.push({
              itemID: id,
              label: trashed
                ? m.batch_import_item_trashed({ id })
                : m.batch_import_item_not_note({ id }),
            });
          }
        },
      );
      const actions = yield* Effect.forEach(notes, (note) => toAction(note));
      const libraries = batchLibraries(
        yield* reads.Libraries({}),
        new Set(
          actions.filter(needsImport).map((action) => action.note.libraryID),
        ),
      );
      yield* logClassified("note", actions, {
        total: itemIDs.length,
        notFound: notFound.length,
      });
      return { actions, notFound, libraries } satisfies {
        actions: ImportAction[];
        notFound: NotFoundEntry[];
        libraries: BatchLibrary[];
      };
    }),
  );
});

// ---------------------------------------------------------------------------
// Modal: child mode (always)
// ---------------------------------------------------------------------------

const openChildImportModal = Effect.fnUntraced(function* (
  ports: BatchImportPorts,
  parentItemIDs: readonly number[],
) {
  const run = yield* modalRunner;
  const profiles = yield* Profile;
  const ids = distinct(parentItemIDs);
  let runnableActions: ImportAction[] = [];
  let profileChoice: ImportProfileChoice | undefined;
  let profilesEnabled = false;
  const profileCounts = new Map<ProfileSelector, BatchProfileCount>();
  const classify = Effect.fnUntraced(function* (
    controls: BatchClassifyControls,
  ) {
    const parents = yield* classifyChildImport(ids, controls);
    const allActions = parents.flatMap((parent) => parent.actions);
    profilesEnabled = (yield* profileRead(profiles.profiles)).length > 0;
    if (profilesEnabled)
      profileChoice = yield* prepareImportProfiles(ports, allActions);
    runnableActions = allActions.filter(needsImport);
    const upToDateChildren = allActions.filter((a) => !needsImport(a));
    return new HierarchyManifest({
      parents: parents.map((parent): HierarchyParent => ({
        label: parent.label,
        profileChoice: parent.actions.some(
          (action) => action.profilePlan?.source === "orphan",
        )
          ? profileChoice
          : undefined,
        children: parent.actions.filter(needsImport).map(actionToTask),
      })),
      upToDate: upToDateChildren.map(importRow),
      upToDateHeader: m.batch_import_group_up_to_date,
      doneHeader: m.batch_import_child_group_done,
      skippedHeader: m.batch_update_group_skipped,
      abortedHeader: m.batch_update_group_aborted,
    });
  });
  yield* Effect.sync(() =>
    ports.view.openBatchModal({
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
        runSummary: (result, state) =>
          profilesEnabled
            ? batchProfileSummary(result, {
                ...state,
                profiles: [...profileCounts.values()],
              })
            : importRunSummary(() => 0)(result, state),
      },
      total: ids.length,
      onClassify: (controls) => run(classify(controls), controls.signal),
      onRun: (controls) =>
        run(
          executeImportRun(ports, runnableActions, {
            controls,
            profileCounts: profilesEnabled ? profileCounts : undefined,
          }),
        ),
    }),
  );
});

interface ChildGroup {
  label: string;
  actions: ImportAction[];
}

/**
 * Expand each lit item into its child notes from the `ChildNoteRefs` stream.
 * Each streamed slice advances the loading bar; an interrupt stops the stream.
 * Parents with no child notes are dropped; the modal's empty confirm state
 * then reports "no child notes to import".
 */
const classifyChildImport = Effect.fnUntraced(function* (
  parentItemIDs: readonly number[],
  controls: Pick<BatchClassifyControls, "onProgress">,
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const groups: { label: string; notes: readonly ChildNote[] }[] = [];
      yield* classifyStream(
        {
          itemIDs: parentItemIDs,
          read: (ids) => reads.ChildNoteRefs({ itemIDs: ids }),
        },
        controls,
        (slice) => {
          for (const { itemID: parentID, ref, notes } of slice) {
            if (notes.length === 0) continue;
            const label =
              ref?.title?.trim() || m.batch_update_untitled({ id: parentID });
            groups.push({ label, notes });
          }
        },
      );
      const parents: ChildGroup[] = yield* Effect.forEach(groups, (group) =>
        Effect.map(
          Effect.forEach(group.notes, (child) => toAction(child)),
          (actions) => ({ label: group.label, actions }),
        ),
      );
      const childActions = parents.flatMap((parent) => parent.actions);
      yield* logClassified("child", childActions, {
        total: parentItemIDs.length,
        notFound: 0,
      });
      return parents;
    }),
  );
});

// ---------------------------------------------------------------------------
// Single note (mode=note, 1 id)
// ---------------------------------------------------------------------------

const importSingleNote = Effect.fnUntraced(function* (
  ports: BatchImportPorts,
  itemID: number,
) {
  const ref = yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const slices = yield* Stream.runCollect(
        reads.NoteRefs({ itemIDs: [itemID] }),
      );
      return slices.flat()[0]?.note;
    }),
  );
  if (!ref) return result({ outcome: "not-found", count: 1 });

  const title = noteLabel(ref);
  const existing = (yield* (yield* NoteIndex).getImportedNoteByNoteKey(
    ref.indexedKey,
  ))[0];
  if (existing) {
    const yes = yield* ports.view.confirm({
      title: m.modal_import_overwrite_title(),
      content: m.modal_import_overwrite_desc({ title }),
      action: m.modal_import_overwrite_confirm(),
      destructive: true,
    });
    if (!yes) return result({ outcome: "cancelled" });
  }

  const write = yield* importOne(ports, ref, existing);
  return result({ outcome: "single", write, title });
});

/** A summary of the excerpts a run reports, to Note Feature when the Scope closes. */
const excerptReports = (ports: BatchImportPorts) =>
  Effect.acquireDisposable(
    Effect.sync(() =>
      collectExcerptSummary((summary) =>
        ports.noteFeature.reportExcerptImages(summary),
      ),
    ),
  );

/** Load a note's full body under a fresh Snapshot and write its mirror. */
const importOne = Effect.fnUntraced(function* (
  ports: BatchImportPorts,
  ref: ChildNote,
  targetFile: TFile | undefined,
) {
  const settings = yield* (yield* PluginSettings).current;
  const importer = yield* NoteImporter;
  // One Snapshot for the read and the write it feeds.
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const [note] = yield* reads.NoteBodies({
        libraryID: ref.libraryID,
        keys: [ref.key],
      });
      if (!note) {
        const skipped: WriteOutcome = "skipped";
        return skipped;
      }
      const excerpts = yield* excerptReports(ports);
      return yield* importer.importNote(note, {
        reads,
        settings,
        reportExcerpts: excerpts.add,
        ...(targetFile ? { targetFile } : {}),
      });
    }),
  );
});

// ---------------------------------------------------------------------------
// Shared run executor (modal onRun)
// ---------------------------------------------------------------------------

/**
 * Execute classified import actions, reporting per-item settle events for the
 * modal's progress bar. Each task loads its own full note (deferred from
 * classification) then writes; a note deleted between classify and its write
 * settles as skipped. Cancel stops the queued remainder while in-flight writes
 * finish.
 */
const executeImportRun = Effect.fnUntraced(function* (
  ports: BatchImportPorts,
  actions: readonly ImportAction[],
  {
    controls,
    profileCounts,
  }: {
    controls: BatchRunControls;
    profileCounts?: Map<ProfileSelector, BatchProfileCount>;
  },
) {
  const settings = yield* (yield* PluginSettings).current;
  const importer = yield* NoteImporter;
  const zoteroReads = yield* ZoteroReads;
  const attachmentFolderCache = new Map<string, string>();
  const failures: { noteKey: string; error: unknown }[] = [];
  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      const excerpts = yield* excerptReports(ports);
      // One run is one initiating batch: every note it writes reuses one
      // retention, released as soon as the run's last admitted consumer
      // settles.
      const outcomes = yield* Effect.acquireDisposable(
        Effect.sync(() => new ExcerptOutcomeScope()),
      );
      // The run's note loads and writes read one Snapshot, held until the run
      // settles.
      const reads = yield* zoteroReads.snapshot;
      const tasks = actions.map((a) => ({ ...a, id: a.note.itemID }));
      return yield* executeBatchRun({
        tasks,
        controls,
        concurrency: IMPORT_CONCURRENCY,
        run: (task) =>
          Effect.gen(function* () {
            const [note] = yield* reads.NoteBodies({
              libraryID: task.note.libraryID,
              keys: [task.note.key],
            });
            if (!note) {
              yield* Effect.logWarning(
                "Imported note vanished before import; skipped",
              ).pipe(
                Effect.annotateLogs({ noteKey: task.note.indexedKey }),
                logged,
              );
              const skipped: RunOutcome = "skipped";
              return skipped;
            }
            const options = {
              reads,
              settings,
              attachmentFolderCache,
              reportExcerpts: excerpts.add,
              outcomes,
              ...(task.kind === "overwrite" ? { targetFile: task.file } : {}),
            };
            const outcome = task.profilePlan
              ? yield* task.profilePlan.import(note, options)
              : yield* importer.importNote(note, options);
            if (profileCounts && task.profilePlan && outcome !== "skipped") {
              const { profile } = task.profilePlan;
              const count = profileCounts.get(profile.selector) ?? {
                label: profile.label ?? m.settings_profile_default_name(),
                created: 0,
                updated: 0,
              };
              count[outcome === "created" ? "created" : "updated"]++;
              profileCounts.set(profile.selector, count);
            }
            const settled: RunOutcome =
              outcome === "overwritten" ? "updated" : outcome;
            return settled;
          }),
        onTaskFailed: (task, error) => {
          failures.push({ noteKey: task.note.indexedKey, error });
        },
      });
    }),
  );
  for (const failure of failures)
    yield* Effect.logWarning("Batch import item failed").pipe(
      Effect.annotateLogs(failure),
      logged,
    );

  yield* Effect.logInfo("Batch import finished").pipe(
    Effect.annotateLogs({ ...result, total: actions.length }),
    logged,
  );
  return result;
});

const logClassified = (
  mode: ImportMode,
  actions: readonly ImportAction[],
  counts: { total: number; notFound: number },
) =>
  Effect.logInfo("Batch import classified").pipe(
    Effect.annotateLogs(
      (() => {
        const grouped = Object.groupBy(actions, (a) => a.kind);
        return {
          mode,
          total: counts.total,
          create: (grouped.create ?? []).length,
          overwrite: (grouped.overwrite ?? []).length,
          "up-to-date": (grouped["up-to-date"] ?? []).length,
          notFound: counts.notFound,
        };
      })(),
    ),
    logged,
  );

/**
 * Resolve an `indexedKey` (from frontmatter) to a parent item's `itemID`, then
 * run a `"child"` batch import. Returns a database-unavailable outcome when
 * the database is closed, or `null` when the key doesn't resolve to a live item.
 */
export const runChildImportByKey = Effect.fn("runChildImportByKey")(function* (
  ports: BatchImportPorts,
  indexedKey: string,
) {
  if (!(yield* databaseReady)) {
    yield* Effect.logWarning("Child-note import: database not ready").pipe(
      Effect.annotateLogs({ indexedKey }),
      logged,
    );
    return result({ outcome: "db-unavailable" });
  }
  const itemID = yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const items = yield* reads.ItemsByIndexedKeys({
        indexedKeys: [indexedKey],
      });
      return items.get(indexedKey)?.itemID;
    }),
  );
  if (itemID == null) return null;
  return yield* runBatchImport(ports, { mode: "child", itemIDs: [itemID] });
});

export type ReimportResult =
  | { outcome: "db-unavailable" }
  | { outcome: "not-found" }
  | { outcome: WriteOutcome };

/**
 * Re-import a single note identified by its `indexedKey`. Resolves the note
 * from the database, then writes/overwrites the imported mirror file.
 */
export const reimportNoteByKey = Effect.fn("reimportNoteByKey")(function* (
  ports: BatchImportPorts,
  noteKey: string,
  targetFile: TFile,
) {
  if (!(yield* databaseReady)) {
    yield* Effect.logWarning("Imported note reimport: database not ready").pipe(
      Effect.annotateLogs({ noteKey }),
      logged,
    );
    const unavailable: ReimportResult = { outcome: "db-unavailable" };
    return unavailable;
  }

  yield* (yield* NoteIndex).whenIndexed;

  const importer = yield* NoteImporter;
  // One Snapshot for the read and the write it feeds.
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const note = yield* readNoteByIndexedKey(reads, noteKey);
      if (!note) {
        const notFound: ReimportResult = { outcome: "not-found" };
        return notFound;
      }

      const settings = yield* (yield* PluginSettings).current;
      const excerpts = yield* excerptReports(ports);
      const writeOutcome = yield* importer.importNote(note, {
        reads,
        settings,
        targetFile,
        reportExcerpts: excerpts.add,
      });
      const written: ReimportResult = { outcome: writeOutcome };
      return written;
    }),
  );
});

/** The live note an Indexed Key names, with its body; `undefined` when none does. */
const readNoteByIndexedKey = Effect.fnUntraced(function* (
  reads: ZoteroReadsApi,
  indexedKey: string,
) {
  const parsed = parseIndexedKey(indexedKey);
  if (!parsed) return undefined;
  const { key, groupID } = parsed;
  const libraryID =
    groupID == null
      ? USER_LIBRARY_ID
      : (yield* reads.Libraries({})).find(
          (library) => library.groupID === groupID,
        )?.libraryID;
  if (libraryID === undefined) return undefined;
  const [note] = yield* reads.NoteBodies({ libraryID, keys: [key] });
  const found: Note | undefined = note;
  return found;
});
