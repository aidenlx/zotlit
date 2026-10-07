import { Effect, Stream } from "effect";
import type { TFile } from "obsidian";

import type { Item, ItemRef } from "@zotlit/db";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { DEFAULT_PROFILE, unknownProfileDiagnostic } from "@/lib/profile-stamp";
import { missingPartialNotice } from "@/lib/workbench-recovery";
import { chooseBatchProfile } from "@/services/batch-profile-choice";
import type { BatchProfilePickerDeps } from "@/services/batch-profile-choice";
import { batchProfileSummary } from "@/services/batch-profile-summary";
import type { BatchProfileCount } from "@/services/batch-profile-summary";
import { classifyStream, runBatchWrite } from "@/services/batch-run";
import type {
  BatchClassifyControls,
  BatchRunControls,
  BatchRunResult,
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
import type { ExcerptSummary } from "@/services/excerpt-image/prepare";
import type { ResolvedProfile } from "@/services/profile/bindings";
import type { LiteratureNoteProfile } from "@/services/profile/service";
import type { Settings } from "@/services/settings/schema";
import { InertTemplateError } from "@/services/template/errors";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";
import { BatchModal, FlatManifest } from "@/views/batch-modal";
import type {
  BatchProfileChoice,
  BatchProfileChoiceScope,
  FlatTask,
} from "@/views/batch-modal";

import type {
  CreateNoteDiagnostic,
  CreateNoteResult,
  NoteOperationDiagnostic,
  UpdateScope,
  CreationProfileSelection,
  PreparedCreationProfile,
} from "./operations";
import {
  describeSelectionProblem,
  describeSelectionSource,
} from "./selection-copy";
import {
  createNoteNotice,
  noteOperationDiagnosticNotice,
  resolveLiteratureNoteWithWarning,
  updateNote,
} from "./update-single";
import type { SingleUpdateDeps } from "./update-single";

const logger = getLogger("batch-update");

function profileLabel(profile: ResolvedProfile): string {
  return profile.label ?? m.settings_profile_default_name();
}

export interface BatchUpdateDeps
  extends SingleUpdateDeps, BatchProfilePickerDeps {}

/**
 * Selection origin keeps the unresolved fallback and explicit recovery scoped
 * to their original rows when the user changes a destination.
 */
type CreationOrigin = "selected" | "unresolved" | "affected";

type CreateAction = {
  kind: "create";
  /** This row's own result from the shared selection boundary. */
  selection?: CreationProfileSelection;
  origin?: CreationOrigin;
  /** Frozen for the run: the destination shown is the destination written. */
  prepared?: PreparedCreationProfile;
};

type BatchAction = {
  itemID: number;
  indexedKey: string;
  label: string;
  libraryID: number;
  profile?: ResolvedProfile;
  unknownStamp?: string;
} & ({ kind: "update"; file: TFile } | CreateAction);

interface NotFoundEntry {
  itemID: number;
  label: string;
}

/** Snapshot-scoped state shared across a run's per-action item loads. */
interface RunContext {
  reportExcerpts: (summary: ExcerptSummary) => void;
  /**
   * Bound to the run's Snapshot; each item loads, renders, and flushes
   * through it.
   */
  reads: ZoteroReadsApi;
  settings: Readonly<Settings>;
  /** The one retention every note this batch writes reuses outcomes from. */
  outcomes: ExcerptOutcomeScope;
  /** How much of each existing note an update refreshes. */
  scope: UpdateScope;
  profile?: ProfileSelector;
}

export type BatchUpdateResult =
  | { outcome: "db-unavailable" }
  | { outcome: "empty-selection" }
  | { outcome: "no-library-in-scope" }
  | { outcome: "unavailable-target" }
  | { outcome: "collection-not-found" }
  | { outcome: "not-found" }
  | { outcome: "single-update" }
  | { outcome: "batch-modal" };

export interface BatchUpdateOptions {
  /** How much of each existing note an update refreshes. */
  scope?: UpdateScope;
  /**
   * Selected Libraries this database holds no Library for. Stated in the
   * confirmation introduction so a partial run is visible before it writes.
   */
  unavailableLibraries?: number;
  /** Companion Profile for new notes; conflicting existing stamps are kept as is. */
  profile?: ProfileSelector;
}

/**
 * Batch-update or create literature notes for `itemIDs`. Owns the
 * database-ready gate, then branches on how many ids the caller asked for:
 *
 * - `0` — nothing to do.
 * - `1` with only Default — route to {@link updateNote} (toast + open).
 * - Otherwise — open the {@link BatchModal}; classification runs inside it as a
 *   chunked loading phase (see {@link classifyActions}), then confirm → run.
 *
 * The count is the flattened total, so a Library Scope expansion reaching one
 * item uses the same Profile-aware rule as an explicit single id.
 *
 * Returns a discriminated result so the caller can map outcomes to UI feedback
 * (notice / toast) without coupling the logic to presentation.
 */
export async function runBatchUpdate(
  deps: BatchUpdateDeps,
  itemIDs: readonly number[],
  opts: BatchUpdateOptions = {},
): Promise<BatchUpdateResult> {
  const { scope = "full", unavailableLibraries = 0, profile } = opts;
  if (deps.db.state !== "ready") {
    logger.warn("Batch update: database not ready", { count: itemIDs.length });
    return { outcome: "db-unavailable" };
  }

  const [firstID, ...restIDs] = itemIDs;
  if (firstID === undefined) {
    return { outcome: "empty-selection" };
  }

  await deps.noteIndex.whenIndexed();
  await deps.profile.ready;
  if (profile !== undefined && !deps.profile.resolveProfile(profile)) {
    throw new BatchUpdateRefusedError(unknownProfileDiagnostic(profile));
  }
  const profilesEnabled = deps.profile.profiles.length > 0;
  if (restIDs.length === 0 && !profilesEnabled) {
    // Single id: hand the lightweight ref to updateNote, which owns the full
    // item load on the create path — no need to hydrate it here. The
    // downstream updateNote reads under its own lease.
    const ref = await displayRef(deps, firstID);
    if (!ref) {
      return { outcome: "not-found" };
    }
    await updateNote(deps, ref, { scope, profile });
    return { outcome: "single-update" };
  }

  // ≥2 ids: classification runs inside the modal's loading phase, where the
  // bar advances per streamed slice and Cancel interrupts the stream;
  // `actions` is captured here for the run callback.
  let actions: BatchAction[] = [];
  let creationItems: Item[] = [];
  let plans: ReadonlyMap<number, readonly PreparedCreationProfile[]> =
    new Map();
  let tasks: FlatTask[] = [];
  let keptCount = 0;
  let notFoundCount = 0;
  const profileCounts = new Map<ProfileSelector, BatchProfileCount>();
  const creations = () =>
    actions.filter(
      (action): action is BatchAction & CreateAction =>
        action.kind === "create",
    );
  /** Bind one row to its selection: resolved Profile, frozen path, row copy. */
  const assign = (
    action: BatchAction & CreateAction,
    selection: CreationProfileSelection,
  ) => {
    action.selection = selection;
    action.profile = selection.problem
      ? undefined
      : deps.profile.resolveProfile(selection.selector);
    action.prepared =
      action.profile &&
      plans
        .get(action.itemID)
        ?.find((entry) => entry.selector === selection.selector);
    const task = tasks.find((entry) => entry.id === action.itemID);
    if (task) Object.assign(task, creationRow(action));
  };
  /** A Profile created after classification has no prepared path yet. */
  const ensurePlans = async (itemID: number, selectors: ProfileSelector[]) => {
    const prepared = plans.get(itemID) ?? [];
    if (
      selectors.every((id) => prepared.some((entry) => entry.selector === id))
    )
      return;
    plans = await deps.noteFeature.prepareBatchCreationProfiles(creationItems);
  };
  const choiceFor = (
    scope: BatchProfileChoiceScope,
    rows: () => (BatchAction & CreateAction)[],
  ): BatchProfileChoice => ({
    scope,
    get count() {
      return rows().length;
    },
    get label() {
      const shared = sharedProfile(rows());
      return shared && profileLabel(shared);
    },
    get source() {
      return rows()[0]?.selection?.source ?? "bound";
    },
    choose: async () => {
      const first = rows()[0];
      if (!first) return;
      await ensurePlans(
        first.itemID,
        deps.profile.profiles.map(({ id }) => id),
      );
      const chosen = await chooseBatchProfile(deps, {
        indexedKey: first.indexedKey,
        selection: fallbackSelection(rows()),
        problem:
          [
            ...new Set(
              rows().flatMap(({ selection }) =>
                selection?.problem
                  ? [describeSelectionProblem(selection.problem)]
                  : [],
              ),
            ),
          ].join(" ") || undefined,
        previews: plans.get(first.itemID) ?? [],
      });
      if (chosen === undefined) return;
      await ensurePlans(first.itemID, [chosen]);
      for (const row of rows())
        assign(row, { selector: chosen, source: "asked", shouldAsk: true });
      logger.debug("Changed batch creation Profile", {
        scope,
        selector: chosen,
        items: rows().length,
      });
    },
  });
  new BatchModal(deps.app, {
    text: {
      title: m.batch_update_title(),
      loadingLabel: m.batch_update_loading_label(),
      loadFailed: m.batch_update_load_failed(),
      runFailed: (error) =>
        missingPartialNotice(error, { app: deps.app }) ??
        (error instanceof InertTemplateError
          ? error.message
          : m.batch_update_run_failed()),
      progressLabel: m.batch_update_progress_label(),
      confirmIntro: ({ actionable, notFound }) =>
        withUnavailableLibraries(
          actionable === 0
            ? m.batch_update_confirm_none({ count: notFound })
            : m.batch_update_confirm_intro({ count: actionable }),
          unavailableLibraries,
        ),
      confirmButton: m.batch_update_confirm_button(),
      runSummary: (result, state) =>
        profilesEnabled
          ? batchProfileSummary(result, {
              ...state,
              profiles: [...profileCounts.values()],
              kept: keptCount,
              notFound: notFoundCount,
            })
          : state.aborted
            ? m.batch_update_aborted(result)
            : state.cancelled
              ? m.batch_update_summary_cancelled(result)
              : m.batch_update_summary(result),
    },
    total: itemIDs.length,
    onClassify: async (controls) => {
      const classified = await classifyActions(deps, itemIDs, {
        controls,
        scope,
        profile,
        profilesEnabled,
      });
      actions = classified.actions;
      keptCount = classified.kept.length;
      notFoundCount = classified.notFound.length;
      let profileChoices: BatchProfileChoice[] | undefined;
      if (profilesEnabled && creations().length > 0) {
        {
          using lease = await deps.zoteroReads.acquireRead();
          const items = await Effect.runPromise(
            lease.reads.ItemsByIndexedKeys({
              indexedKeys: creations().map((action) => action.indexedKey),
            }),
            { signal: controls.signal },
          );
          creationItems = creations().flatMap(
            (action) => items.get(action.indexedKey) ?? [],
          );
        }
        plans = await deps.noteFeature.prepareBatchCreationProfiles(
          creationItems,
          { signal: controls.signal },
        );
        // Each Item keeps its own result and prepared destination. Overlap
        // rows need a choice; the fallback also covers unmatched Items.
        for (const action of creations()) {
          const selection = await deps.noteFeature.resolveCreationProfile({
            headless: profile,
            item: creationItems.find((item) => item.itemID === action.itemID),
          });
          action.origin =
            selection.problem && selection.problem.kind !== "overlap"
              ? "affected"
              : selection.source === "bound"
                ? "unresolved"
                : "selected";
          assign(action, selection);
        }
        const rowsOf = (origin: CreationOrigin) => () =>
          creations().filter((action) => action.origin === origin);
        profileChoices = [
          ...(rowsOf("unresolved")().length > 0
            ? [choiceFor("unresolved", rowsOf("unresolved"))]
            : []),
          ...(rowsOf("affected")().length > 0
            ? [choiceFor("affected", rowsOf("affected"))]
            : []),
          choiceFor("all-new", creations),
        ];
      }
      tasks = actions.map((action) => ({
        id: action.itemID,
        label: action.label,
        kind: batchGroupKey(action.libraryID, action.kind),
        ...(profilesEnabled
          ? action.kind === "create"
            ? creationRow(action)
            : {
                profile: action.profile
                  ? profileLabel(action.profile)
                  : action.unknownStamp,
              }
          : {}),
      }));
      return new FlatManifest({
        tasks,
        notFound: classified.notFound,
        profileChoices,
        groups: batchGroups(classified.libraries, [
          { kind: "update", header: m.batch_update_group_update },
          {
            kind: "create",
            header: m.batch_update_group_create,
          },
        ]),
        // Non-actionable, so it rides the static informational slot rather than
        // a task group — this keeps them out of the actionable count driving
        // the confirm intro.
        upToDate: classified.skipped,
        upToDateHeader: m.batch_update_group_skipped,
        kept: classified.kept,
        keptHeader: m.batch_profile_kept_header,
        notFoundHeader: m.batch_update_group_not_found,
        abortedHeader: m.batch_update_group_aborted,
      });
    },
    onRun: (controls) =>
      executeBatchActions(
        deps,
        {
          actions,
          scope,
          profile,
          profileCounts: profilesEnabled ? profileCounts : undefined,
        },
        controls,
      ),
  }).open();
  return { outcome: "batch-modal" };
}

/** The Profile every row shares, or `undefined` while they differ or wait. */
function sharedProfile(
  rows: readonly (BatchAction & CreateAction)[],
): ResolvedProfile | undefined {
  const [first, ...rest] = rows;
  if (!first?.profile) return undefined;
  return rest.every((row) => row.profile?.selector === first.profile!.selector)
    ? first.profile
    : undefined;
}

/** Aggregate every overlap so a shared fallback exposes all candidate identities. */
function fallbackSelection(
  rows: readonly CreateAction[],
): CreationProfileSelection {
  const candidates = new Map<ProfileSelector, LiteratureNoteProfile>();
  for (const { selection } of rows)
    if (selection?.problem?.kind === "overlap")
      for (const candidate of selection.problem.candidates)
        candidates.set(candidate.id, candidate);
  if (candidates.size)
    return {
      selector: DEFAULT_PROFILE,
      source: "bound",
      shouldAsk: true,
      problem: { kind: "overlap", candidates: [...candidates.values()] },
    };
  return (
    rows[0]?.selection ?? {
      selector: DEFAULT_PROFILE,
      source: "bound",
      shouldAsk: true,
    }
  );
}

/** A new row's chip, frozen destination, and the reason behind them. */
function creationRow(
  action: BatchAction & CreateAction,
): Pick<FlatTask, "profile" | "path" | "reason"> {
  const { selection, prepared } = action;
  return {
    profile: action.profile && profileLabel(action.profile),
    path: prepared?.path,
    reason:
      [selection && creationReason(selection), prepared?.unavailable]
        .filter(Boolean)
        .join(" ") || undefined,
  };
}

/** Why a new row goes where it goes: its problem, its match, or its source. */
function creationReason(selection: CreationProfileSelection): string {
  if (selection.problem) return describeSelectionProblem(selection.problem);
  if (selection.source === "match") return selection.reason;
  return (
    describeSelectionSource(selection.source) ?? m.profile_match_unmatched()
  );
}

/** The lightweight ref of one item; `null` when no live item has that id. */
async function displayRef(
  deps: Pick<SingleUpdateDeps, "zoteroReads">,
  itemID: number,
): Promise<ItemRef | null> {
  using lease = await deps.zoteroReads.acquireRead();
  const slices = await Effect.runPromise(
    Stream.runCollect(lease.reads.DisplayRefs({ itemIDs: [itemID] })),
  );
  return slices.flat()[0]?.ref ?? null;
}

/**
 * Resolve `itemIDs` into update / create / skipped / not-found from the
 * `DisplayRefs` stream (indexed key + title only, no heavy relational load —
 * that is deferred to each item's write task), matched against the Note Index
 * here. Each streamed slice advances the loading bar; Cancel interrupts the
 * stream.
 *
 * A `metadata` scope classifies note-less items as skipped rather than create —
 * see {@link updateNote} for why the narrowing never creates.
 *
 * @throws when {@link BatchClassifyControls.signal} aborts (cancel /
 *   dismiss) or a query fails; the modal turns that into a close / notice.
 */
async function classifyActions(
  deps: SingleUpdateDeps,
  itemIDs: readonly number[],
  {
    controls,
    scope,
    profile,
    profilesEnabled,
  }: {
    controls: BatchClassifyControls;
    scope: UpdateScope;
    profile?: ProfileSelector;
    profilesEnabled: boolean;
  },
): Promise<{
  actions: BatchAction[];
  skipped: NotFoundEntry[];
  notFound: NotFoundEntry[];
  libraries: BatchLibrary[];
  kept: { label: string; profile: string; reason: string }[];
}> {
  // One Snapshot for the refs and the Libraries they are grouped by.
  using lease = await deps.zoteroReads.acquireRead();
  const actions: BatchAction[] = [];
  const skipped: NotFoundEntry[] = [];
  const notFound: NotFoundEntry[] = [];
  const kept: { label: string; profile: string; reason: string }[] = [];
  await classifyStream(
    lease.reads.DisplayRefs({ itemIDs }),
    controls,
    (slice) => {
      for (const { itemID, ref } of slice) {
        if (!ref) {
          notFound.push({
            itemID,
            label: m.batch_update_unknown_item({ id: itemID }),
          });
          continue;
        }
        const file = resolveLiteratureNoteWithWarning(
          deps.noteIndex.getNotesByItemKey(ref.indexedKey),
        );
        const label = itemLabel(ref.title, itemID);
        const row = {
          itemID,
          indexedKey: ref.indexedKey,
          label,
          libraryID: ref.libraryID,
        };
        if (file) {
          const stamped = deps.profile.profileOf(file);
          if (
            profilesEnabled &&
            stamped.ok &&
            profile !== undefined &&
            stamped.profile.selector !== profile
          ) {
            kept.push({
              label,
              profile: profileLabel(stamped.profile),
              reason: m.batch_profile_kept_reason({
                label: profileLabel(stamped.profile),
                requested: profileLabel(deps.profile.resolveProfile(profile)!),
              }),
            });
          } else {
            actions.push({
              ...row,
              kind: "update",
              file,
              ...(stamped.ok
                ? { profile: stamped.profile }
                : { unknownStamp: stamped.stamped.stamp }),
            });
          }
        } else if (scope === "metadata") {
          skipped.push({ itemID, label });
        } else {
          actions.push({ ...row, kind: "create" });
        }
      }
    },
  );

  const libraries = batchLibraries(
    await Effect.runPromise(lease.reads.Libraries({})),
    new Set(actions.map((action) => action.libraryID)),
  );

  logger.info("Batch update classified", () => {
    const { update = [], create = [] } = Object.groupBy(actions, (t) => t.kind);
    return {
      total: itemIDs.length,
      update: update.length,
      create: create.length,
      skipped: skipped.length,
      kept: kept.length,
      notFound: notFound.length,
      libraries: libraries.length,
    };
  });
  return { actions, skipped, notFound, libraries, kept };
}

async function executeBatchActions(
  deps: SingleUpdateDeps,
  plan: {
    actions: readonly BatchAction[];
    scope: UpdateScope;
    profile?: ProfileSelector;
    profileCounts?: Map<ProfileSelector, BatchProfileCount>;
  },
  controls: BatchRunControls,
): Promise<BatchRunResult> {
  const { actions, scope, profile } = plan;
  using excerptReports = collectExcerptSummary((summary) =>
    deps.noteFeature.reportExcerptImages(summary),
  );
  const [settings] = await Promise.all([
    deps.settings.loaded,
    deps.noteFeature.ready,
  ]);
  // The whole run is one initiating batch, so every row's notes — including the
  // Child Notes they import — reuse one retention; it is released as soon as
  // the run's last admitted consumer settles.
  await using outcomes = new ExcerptOutcomeScope();

  // Scope spans the whole batch; the Snapshot-bound `reads` is only available
  // inside the run closure, so it is passed per call instead of baked in here.
  const baseContext: Omit<RunContext, "reads"> = {
    reportExcerpts: excerptReports.add,
    settings,
    scope,
    profile,
    outcomes,
  };

  // The run's item loads and updates read one Snapshot, held until the run
  // settles.
  const result = await runBatchWrite({
    zoteroReads: deps.zoteroReads,
    tasks: actions.map((a) => ({ ...a, id: a.itemID })),
    controls,
    concurrency: 32,
    run: async (task, reads) => {
      const outcome = await runAction(deps, task, { ...baseContext, reads });
      if (
        plan.profileCounts &&
        task.profile &&
        (outcome === "created" || outcome === "updated")
      ) {
        const count = plan.profileCounts.get(task.profile.selector) ?? {
          label: profileLabel(task.profile),
          created: 0,
          updated: 0,
        };
        count[outcome]++;
        plan.profileCounts.set(task.profile.selector, count);
      }
      return outcome;
    },
    onTaskFailed: (task, error) => {
      logger.warn("Batch update item failed", {
        itemID: task.itemID,
        error,
      });
    },
    haltOn: (error) => error instanceof InertTemplateError,
  });

  logger.info("Batch update finished", {
    ...result,
    total: actions.length,
  });
  return result;
}

/**
 * Load the action's full item (deferred from classification) and write it: an
 * existing-note update reuses {@link writeNoteUpdate} under the batch's
 * Snapshot; a create routes through the self-contained
 * {@link createNote} (resolves tags + path, then writes — a filename collision
 * surfaces as this item's own `vault.create` failure). An item deleted in
 * Zotero between classification and its write throws here, surfacing as this
 * item's failure (not aborting the run).
 */
async function runAction(
  deps: SingleUpdateDeps,
  action: BatchAction,
  run: RunContext,
): Promise<RunOutcome> {
  const items = await Effect.runPromise(
    run.reads.ItemsByIndexedKeys({ indexedKeys: [action.indexedKey] }),
  );
  const item = items.get(action.indexedKey);
  if (!item)
    throw new Error(m.batch_update_unknown_item({ id: action.itemID }));

  if (action.kind === "update") {
    const result = await deps.noteFeature.writeNoteUpdate(action.file, {
      reportExcerpts: run.reportExcerpts,
      reads: run.reads,
      item,
      settings: run.settings,
      scope: run.scope,
      outcomes: run.outcomes,
    });
    if (result.diagnostic) {
      throw new BatchUpdateRefusedError(result.diagnostic);
    }
    return "updated";
  }
  // A stopped selection the user never resolved writes nothing: no fallback
  // Profile stands in for the choice the row asked for.
  if (action.selection?.problem)
    throw new Error(describeSelectionProblem(action.selection.problem));
  if (action.prepared) {
    // The selection stays frozen; only its availability is checked again.
    if (!deps.profile.resolveProfile(action.prepared.selector))
      throw new BatchUpdateRefusedError(
        unknownProfileDiagnostic(action.prepared.selector),
      );
    return batchCreateOutcome(
      await action.prepared.create({
        reportExcerpts: run.reportExcerpts,
        outcomes: run.outcomes,
        reads: run.reads,
      }),
    );
  }
  const result = await deps.noteFeature.createNote(item, {
    reportExcerpts: run.reportExcerpts,
    profile: action.selection?.selector ?? run.profile,
    outcomes: run.outcomes,
    reads: run.reads,
  });
  return batchCreateOutcome(result);
}

export class BatchUpdateRefusedError extends Error {
  readonly diagnostic: NoteOperationDiagnostic;

  constructor(diagnostic: NoteOperationDiagnostic) {
    super(noteOperationDiagnosticNotice(diagnostic));
    this.name = "BatchUpdateRefusedError";
    this.diagnostic = diagnostic;
  }
}

export class BatchCreateRefusedError extends Error {
  readonly diagnostic: CreateNoteDiagnostic;

  constructor(result: Extract<CreateNoteResult, { outcome: "refused" }>) {
    super(createNoteNotice(result));
    this.name = "BatchCreateRefusedError";
    this.diagnostic = result.diagnostic;
  }
}

export function batchCreateOutcome(result: CreateNoteResult): "created" {
  if (result.outcome === "refused") {
    throw new BatchCreateRefusedError(result);
  }
  return "created";
}

/**
 * Fetch every regular item a target covers and run a batch update. An exact
 * `target` names one Library, optionally narrowed to one collection; no target
 * expands every available Library of the current Library Scope, in canonical
 * order, under this one planning lease. The modal's loading phase shows progress
 * while items are classified, and the user can cancel before the run starts.
 *
 * @param target.groupID names the exact Library the run covers — `0` for
 *   My Library, a positive integer for a group. A group this database doesn't
 *   hold returns `unavailable-target` without scanning.
 * @param target.collectionKey narrows the run to that collection of the named
 *   Library and every collection nested under it. A key that Library doesn't
 *   hold returns `collection-not-found`.
 */
export async function runBatchUpdateAll(
  deps: BatchUpdateDeps,
  target: BatchTarget = {},
): Promise<BatchUpdateResult> {
  if (deps.db.state !== "ready") {
    logger.warn("Batch update all: database not ready");
    return { outcome: "db-unavailable" };
  }

  const plan = await planBatchScope(deps, "literature-items", target);
  if (plan.outcome !== "resolved") {
    return { outcome: plan.outcome };
  }

  if (plan.itemIDs.length === 0) {
    return { outcome: "empty-selection" };
  }
  return runBatchUpdate(deps, plan.itemIDs, {
    unavailableLibraries: plan.unavailableLibraries,
  });
}

function itemLabel(title: string | null, itemID: number): string {
  return title?.trim() || m.batch_update_untitled({ id: itemID });
}
