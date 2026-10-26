import { Effect, Option, Predicate, Schema } from "effect";
import type { TFile } from "obsidian";

import type { ItemRef } from "@zotlit/db";

import type { EffectBridge } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import * as m from "@/lib/i18n/generated/messages";
import { Notifier, withProgress } from "@/lib/notifier";
import { MetadataCache } from "@/lib/obsidian-metadata-cache";
import { Workspace } from "@/lib/obsidian-workspace";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { DEFAULT_PROFILE, unknownProfileDiagnostic } from "@/lib/profile-stamp";
import { batchProfileSummary } from "@/services/batch-profile-summary";
import type { BatchProfileCount } from "@/services/batch-profile-summary";
import {
  classifyStream,
  executeBatchRun,
  modalRunner,
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
import type { BatchTarget } from "@/services/batch-scope";
import { ExcerptOutcomeScope } from "@/services/excerpt-image/outcome-scope";
import type { ExcerptSummary } from "@/services/excerpt-image/prepare";
import type { LibraryScope } from "@/services/library-scope/service";
import type { NoteImportView } from "@/services/note-import/view";
import {
  itemKeyFromFrontmatter,
  NoteIndex,
} from "@/services/note-index/service";
import type { ResolvedProfile } from "@/services/profile/bindings";
import { Profile } from "@/services/profile/service";
import type { LiteratureNoteProfile } from "@/services/profile/service";
import type { Settings } from "@/services/settings/schema";
import { PluginSettings } from "@/services/settings/service";
import { isInertTemplateError } from "@/services/template/errors";
import type { ZoteroPref } from "@/services/zotero-pref/service";
import { readDisplayRef } from "@/services/zotero-reads/display-ref";
import type { ItemDisplayRef } from "@/services/zotero-reads/display-ref";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";
import { FlatManifest } from "@/views/batch-modal";
import type {
  BatchProfileChoice,
  BatchProfileChoiceScope,
  FlatTask,
} from "@/views/batch-modal";

import type {
  PlannedCreation,
  PlannedCreationProfile,
} from "./creation-planning";
import type {
  CreateNoteDiagnostic,
  CreateNoteResult,
  NoteOperationDiagnostic,
  UpdateScope,
  CreationProfileSelection,
} from "./operations";
import {
  describeSelectionProblem,
  describeSelectionSource,
} from "./selection-copy";
import { collectExcerptReports, NoteFeature } from "./service";
import {
  createNoteNotice,
  duplicateLiteratureNoteWarning,
  noteOperationDiagnosticNotice,
  updateWithNotice,
} from "./update-single";
import type { BatchUpdateNotices } from "./update-single";

const logged = withLogCategory("batch-update");

function profileLabel(profile: ResolvedProfile): string {
  return profile.label ?? m.settings_profile_default_name();
}

/** The services a note update reads through their tags. */
export type BatchUpdateServices =
  | LibraryScope
  | MetadataCache
  | NoteFeature
  | NoteIndex
  | Notifier
  | PluginSettings
  | Profile
  | Workspace
  | ZoteroPref
  | ZoteroReads;

/**
 * The legacy values a note update calls: the UI port for the batch modal and
 * the Profile picker, the notices the caller builds, and the bridge the
 * modal's callbacks enter Effect through.
 */
export interface BatchUpdatePorts {
  readonly notices: BatchUpdateNotices;
  readonly bridge: Pick<EffectBridge, "runPromiseExit">;
  readonly view: Pick<NoteImportView, "openBatchModal" | "chooseProfile">;
}

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
  prepared?: PlannedCreationProfile;
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
  /** Checks that a frozen creation Profile still exists. */
  profiles: Profile["Service"];
  /** Writes each row's note. */
  noteFeature: NoteFeature["Service"];
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

/** `value` as a {@link BatchUpdateResult}, so each branch returns one type. */
const updateResult = (value: BatchUpdateResult): BatchUpdateResult => value;

/** Whether the database answers reads now. */
const databaseReady = Effect.gen(function* () {
  return (yield* (yield* ZoteroReads).current).state === "ready";
});

/** The first of `notes`, after a notice when the Item has more than one. */
const literatureNoteWithWarning = Effect.fnUntraced(function* (
  notes: readonly TFile[],
) {
  const warning = duplicateLiteratureNoteWarning(notes);
  if (warning) yield* (yield* Notifier).show(warning);
  const first: TFile | undefined = notes[0];
  return first;
});

/**
 * Batch-update or create literature notes for `itemIDs`. Owns the
 * database-ready gate, then branches on how many ids the caller asked for:
 *
 * - `0` — nothing to do.
 * - `1` with only Default — route to {@link updateNote} (toast + open).
 * - Otherwise — open the batch modal; classification runs inside it as a
 *   chunked loading phase (see {@link classifyActions}), then confirm → run.
 *
 * The count is the flattened total, so a Library Scope expansion reaching one
 * item uses the same Profile-aware rule as an explicit single id.
 *
 * Returns a discriminated result so the caller can map outcomes to UI feedback
 * (notice / toast) without coupling the logic to presentation.
 */
export const runBatchUpdate = Effect.fn("runBatchUpdate")(function* (
  ports: BatchUpdatePorts,
  itemIDs: readonly number[],
  opts: BatchUpdateOptions = {},
) {
  const { scope = "full", unavailableLibraries = 0, profile } = opts;
  if (!(yield* databaseReady)) {
    yield* Effect.logWarning("Batch update: database not ready").pipe(
      Effect.annotateLogs({ count: itemIDs.length }),
      logged,
    );
    return updateResult({ outcome: "db-unavailable" });
  }

  const [firstID, ...restIDs] = itemIDs;
  if (firstID === undefined) {
    return updateResult({ outcome: "empty-selection" });
  }

  yield* (yield* NoteIndex).whenIndexed;
  const profiles = yield* Profile;
  if (profile !== undefined && !(yield* profiles.resolveProfile(profile))) {
    return yield* new BatchUpdateRefusedError({
      diagnostic: unknownProfileDiagnostic(profile),
    });
  }
  const profilesEnabled = (yield* profiles.profiles).length > 0;
  if (restIDs.length === 0 && !profilesEnabled) {
    // Single id: hand the lightweight ref to updateNote, which owns the full
    // item load on the create path — no need to hydrate it here.
    const ref = yield* displayRef(firstID);
    if (!ref) {
      return updateResult({ outcome: "not-found" });
    }
    yield* updateNote(ports, ref, { scope, profile });
    return updateResult({ outcome: "single-update" });
  }

  yield* openBatchUpdateModal(ports, itemIDs, {
    scope,
    unavailableLibraries,
    profile,
    profilesEnabled,
  });
  return updateResult({ outcome: "batch-modal" });
});

/**
 * Update the existing literature note, or create + open one if none exists.
 * `scope` controls how much an existing note is refreshed (see {@link UpdateScope}).
 *
 * A `metadata` scope never creates: the whole point of the narrowing is to leave
 * the body alone, and `createNote` would write a full templated one. Missing
 * notes report and stop, leaving the full-scope action as the way to create.
 */
const updateNote = Effect.fnUntraced(function* (
  ports: BatchUpdatePorts,
  ref: ItemRef,
  { scope, profile }: { scope: UpdateScope; profile?: ProfileSelector },
) {
  const file = yield* literatureNoteWithWarning(
    yield* (yield* NoteIndex).getNotesByItemKey(ref.indexedKey),
  );

  if (!file) {
    if (scope === "metadata") {
      yield* (yield* Notifier).show(m.notice_update_metadata_no_note());
      return;
    }
    yield* createAndOpen(ports, ref, profile);
    return;
  }

  const itemKey = itemKeyFromFrontmatter(
    yield* (yield* MetadataCache).fileCache(file),
  );
  if (!itemKey) return;

  yield* updateWithNotice(
    file,
    { indexedKey: itemKey, scope, profile },
    ports.notices.updateToast(scope),
  );
});

/** Lazily resolve the full Item and create + open a new literature note. */
const createAndOpen = Effect.fnUntraced(function* (
  ports: BatchUpdatePorts,
  ref: ItemRef,
  profile: ProfileSelector | undefined,
) {
  const { reads } = yield* ZoteroReads;
  const items = yield* reads.ItemsByIndexedKeys({
    indexedKeys: [ref.indexedKey],
  });
  const item = items.get(ref.indexedKey);
  if (!item) return;

  // The notice tells the user how a create failed or why it wrote nothing.
  const created = yield* withProgress(
    (yield* NoteFeature).createNote(item, { profile }),
    ports.notices.createToast,
  ).pipe(Effect.option);
  if (Option.isNone(created) || created.value.outcome !== "created") return;
  yield* (yield* Workspace).openLinkText(created.value.file.path, "", {
    newLeaf: false,
    state: { active: true },
  });
});

/**
 * The batch modal: classification runs inside its loading phase, where the
 * bar advances per streamed slice and Cancel interrupts the stream; the
 * classified actions are held here for the run callback. The modal's
 * callbacks run their Effects on the services this Effect runs with.
 */
const openBatchUpdateModal = Effect.fnUntraced(function* (
  ports: BatchUpdatePorts,
  itemIDs: readonly number[],
  {
    scope,
    unavailableLibraries,
    profile,
    profilesEnabled,
  }: {
    scope: UpdateScope;
    unavailableLibraries: number;
    profile: ProfileSelector | undefined;
    profilesEnabled: boolean;
  },
) {
  const { run, settle } = yield* modalRunner<BatchUpdateServices>(ports.bridge);
  const profiles = yield* Profile;
  let actions: BatchAction[] = [];
  const noteFeature = yield* NoteFeature;
  let plans: ReadonlyMap<string, PlannedCreation> = new Map();
  let keptCount = 0;
  let notFoundCount = 0;
  const profileCounts = new Map<ProfileSelector, BatchProfileCount>();
  const creations = () =>
    actions.filter(
      (action): action is BatchAction & CreateAction =>
        action.kind === "create",
    );
  /** Bind one row to its selection: resolved Profile and frozen path. */
  const assign = Effect.fnUntraced(function* (
    action: BatchAction & CreateAction,
    selection: CreationProfileSelection,
  ) {
    action.selection = selection;
    action.profile = selection.problem
      ? undefined
      : yield* profiles.resolveProfile(selection.selector);
    action.prepared =
      action.profile &&
      plans
        .get(action.indexedKey)
        ?.previews.find((entry) => entry.selector === selection.selector);
  });
  /** A Profile created after classification has no prepared path yet. */
  const ensurePlans = Effect.fnUntraced(function* (
    indexedKey: string,
    selectors: readonly ProfileSelector[],
  ) {
    const prepared = plans.get(indexedKey)?.previews ?? [];
    if (
      selectors.every((id) => prepared.some((entry) => entry.selector === id))
    )
      return;
    plans = yield* noteFeature.planCreations(
      creations().map((action) => action.indexedKey),
      { headless: profile },
    );
  });
  const choose = Effect.fnUntraced(function* (
    scope: BatchProfileChoiceScope,
    rows: () => (BatchAction & CreateAction)[],
  ) {
    const first = rows()[0];
    if (!first) return;
    yield* ensurePlans(
      first.indexedKey,
      (yield* profiles.profiles).map(({ id }) => id),
    );
    const chosen = yield* ports.view.chooseProfile({
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
      previews: plans.get(first.indexedKey)?.previews ?? [],
    });
    if (chosen === undefined) return;
    yield* ensurePlans(first.indexedKey, [chosen]);
    for (const row of rows())
      yield* assign(row, {
        selector: chosen,
        source: "asked",
        shouldAsk: true,
      });
    yield* Effect.logDebug("Changed batch creation Profile").pipe(
      Effect.annotateLogs({ scope, selector: chosen, items: rows().length }),
      logged,
    );
  });
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
    choose: () => settle(choose(scope, rows)),
  });
  const classify = Effect.fnUntraced(function* (
    controls: BatchClassifyControls,
  ) {
    const classified = yield* classifyActions(itemIDs, {
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
      // Each Item keeps its own result and prepared destination. Overlap
      // rows need a choice; the fallback also covers unmatched Items.
      plans = yield* noteFeature.planCreations(
        creations().map((action) => action.indexedKey),
        { headless: profile },
      );
      for (const action of creations()) {
        const { selection } = plans.get(action.indexedKey)!;
        action.origin =
          selection.problem && selection.problem.kind !== "overlap"
            ? "affected"
            : selection.source === "bound"
              ? "unresolved"
              : "selected";
        yield* assign(action, selection);
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
    return new FlatManifest({
      tasks: actions.map((action) => batchTask(action, profilesEnabled)),
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
  });
  yield* Effect.sync(() =>
    ports.view.openBatchModal({
      text: {
        title: m.batch_update_title(),
        loadingLabel: m.batch_update_loading_label(),
        loadFailed: m.batch_update_load_failed(),
        runFailed: ports.notices.runFailed,
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
      // The modal's cancel interrupts the classification.
      onClassify: (controls) => run(classify(controls), controls.signal),
      onRun: (controls) =>
        run(
          executeBatchActions(
            ports,
            {
              actions,
              scope,
              profile,
              profileCounts: profilesEnabled ? profileCounts : undefined,
            },
            controls,
          ),
        ),
    }),
  );
});

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

/**
 * One action's confirmation row. A new row reads its chip, frozen
 * destination, and the reason behind them from the action, so a Profile
 * change shows on the next render.
 */
function batchTask(action: BatchAction, profilesEnabled: boolean): FlatTask {
  const task = {
    id: action.itemID,
    label: action.label,
    kind: batchGroupKey(action.libraryID, action.kind),
  };
  if (!profilesEnabled) return task;
  if (action.kind !== "create")
    return {
      ...task,
      profile: action.profile
        ? profileLabel(action.profile)
        : action.unknownStamp,
    };
  return {
    ...task,
    get profile() {
      return action.profile && profileLabel(action.profile);
    },
    get path() {
      return action.prepared?.path;
    },
    get reason() {
      const { selection, prepared } = action;
      return (
        [selection && creationReason(selection), prepared?.unavailable]
          .filter(Boolean)
          .join(" ") || undefined
      );
    },
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
const displayRef = Effect.fnUntraced(function* (itemID: number) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      return yield* readDisplayRef(reads, itemID);
    }),
  );
});

/**
 * Resolve `itemIDs` into update / create / skipped / not-found from the
 * `DisplayRefs` stream (indexed key + title only, no heavy relational load —
 * that is deferred to each item's write task), matched against the Note Index
 * once the stream ends. Each streamed slice advances the loading bar; an
 * interrupt stops the stream.
 *
 * A `metadata` scope classifies note-less items as skipped rather than create —
 * see {@link updateNote} for why the narrowing never creates.
 */
const classifyActions = Effect.fnUntraced(function* (
  itemIDs: readonly number[],
  {
    controls,
    scope,
    profile,
    profilesEnabled,
  }: {
    controls: Pick<BatchClassifyControls, "onProgress">;
    scope: UpdateScope;
    profile?: ProfileSelector;
    profilesEnabled: boolean;
  },
) {
  const noteIndex = yield* NoteIndex;
  const profiles = yield* Profile;
  // One Snapshot for the refs and the Libraries they are grouped by.
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const actions: BatchAction[] = [];
      const skipped: NotFoundEntry[] = [];
      const notFound: NotFoundEntry[] = [];
      const kept: { label: string; profile: string; reason: string }[] = [];
      const refs: { itemID: number; ref: ItemDisplayRef }[] = [];
      yield* classifyStream(
        { itemIDs, read: (ids) => reads.DisplayRefs({ itemIDs: ids }) },
        controls,
        (slice) => {
          for (const { itemID, ref } of slice) {
            if (ref) refs.push({ itemID, ref });
            else
              notFound.push({
                itemID,
                label: m.batch_update_unknown_item({ id: itemID }),
              });
          }
        },
      );
      for (const { itemID, ref } of refs) {
        const file = yield* literatureNoteWithWarning(
          yield* noteIndex.getNotesByItemKey(ref.indexedKey),
        );
        const label = itemLabel(ref.title, itemID);
        const row = {
          itemID,
          indexedKey: ref.indexedKey,
          label,
          libraryID: ref.libraryID,
        };
        if (file) {
          const stamped = yield* profiles.profileOf(file);
          if (
            profilesEnabled &&
            stamped.ok &&
            profile !== undefined &&
            stamped.profile.selector !== profile
          ) {
            const requested = (yield* profiles.resolveProfile(profile))!;
            kept.push({
              label,
              profile: profileLabel(stamped.profile),
              reason: m.batch_profile_kept_reason({
                label: profileLabel(stamped.profile),
                requested: profileLabel(requested),
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

      const libraries = batchLibraries(
        yield* reads.Libraries({}),
        new Set(actions.map((action) => action.libraryID)),
      );

      const { update = [], create = [] } = Object.groupBy(
        actions,
        (t) => t.kind,
      );
      yield* Effect.logInfo("Batch update classified").pipe(
        Effect.annotateLogs({
          total: itemIDs.length,
          update: update.length,
          create: create.length,
          skipped: skipped.length,
          kept: kept.length,
          notFound: notFound.length,
          libraries: libraries.length,
        }),
        logged,
      );
      return { actions, skipped, notFound, libraries, kept };
    }),
  );
});

/**
 * Execute the classified actions, reporting per-item settle events for the
 * modal's progress bar. The run's item loads and updates read one Snapshot,
 * held until the run settles.
 */
const executeBatchActions = Effect.fnUntraced(function* (
  ports: BatchUpdatePorts,
  plan: {
    actions: readonly BatchAction[];
    scope: UpdateScope;
    profile?: ProfileSelector;
    profileCounts?: Map<ProfileSelector, BatchProfileCount>;
  },
  controls: BatchRunControls,
) {
  const { actions, scope, profile } = plan;
  const zoteroReads = yield* ZoteroReads;
  const profiles = yield* Profile;
  const noteFeature = yield* NoteFeature;
  const failures: { itemID: number; error: unknown }[] = [];
  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      const excerptReports = yield* collectExcerptReports;
      const settings = yield* (yield* PluginSettings).current;
      // The whole run is one initiating batch, so every row's notes —
      // including the Child Notes they import — reuse one retention; it is
      // released as soon as the run's last admitted consumer settles.
      const outcomes = yield* Effect.acquireDisposable(
        Effect.sync(() => new ExcerptOutcomeScope()),
      );
      const reads = yield* zoteroReads.snapshot;
      const run: RunContext = {
        reportExcerpts: excerptReports.add,
        reads,
        settings,
        scope,
        profile,
        outcomes,
        profiles,
        noteFeature,
      };
      return yield* executeBatchRun({
        tasks: actions.map((a) => ({ ...a, id: a.itemID })),
        controls,
        concurrency: 32,
        run: (task) =>
          Effect.tap(runAction(ports, task, run), (outcome) =>
            Effect.sync(() => {
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
            }),
          ),
        onTaskFailed: (task, error) => {
          failures.push({ itemID: task.itemID, error });
        },
        // A template that cannot render fails the write with its refusal.
        haltOn: isInertTemplateError,
      });
    }),
  );
  for (const failure of failures)
    yield* Effect.logWarning("Batch update item failed").pipe(
      Effect.annotateLogs(failure),
      logged,
    );

  yield* Effect.logInfo("Batch update finished").pipe(
    Effect.annotateLogs({ ...result, total: actions.length }),
    logged,
  );
  return result;
});

/**
 * Load the action's full item (deferred from classification) and write it: an
 * existing-note update reuses `writeNoteUpdate` under the batch's Snapshot; a
 * create routes through the self-contained `createNote` (resolves tags + path,
 * then writes — a filename collision surfaces as this item's own
 * `vault.create` failure). An item deleted in Zotero between classification
 * and its write fails here, surfacing as this item's failure (not aborting the
 * run).
 */
const runAction = Effect.fnUntraced(function* (
  ports: BatchUpdatePorts,
  action: BatchAction,
  run: RunContext,
) {
  const items = yield* run.reads.ItemsByIndexedKeys({
    indexedKeys: [action.indexedKey],
  });
  const item = items.get(action.indexedKey);
  if (!item)
    return yield* new BatchRowRefused({
      message: m.batch_update_unknown_item({ id: action.itemID }),
    });

  if (action.kind === "update") {
    const updated = yield* run.noteFeature.writeNoteUpdate(action.file, {
      reportExcerpts: run.reportExcerpts,
      reads: run.reads,
      item,
      settings: run.settings,
      scope: run.scope,
      outcomes: run.outcomes,
    });
    if (updated.diagnostic) {
      return yield* new BatchUpdateRefusedError({
        diagnostic: updated.diagnostic,
      });
    }
    const outcome: RunOutcome = "updated";
    return outcome;
  }
  // A stopped selection the user never resolved writes nothing: no fallback
  // Profile stands in for the choice the row asked for.
  if (action.selection?.problem)
    return yield* new BatchRowRefused({
      message: describeSelectionProblem(action.selection.problem),
    });
  const prepared = action.prepared;
  if (prepared) {
    // The selection stays frozen; only its availability is checked again.
    if (!(yield* run.profiles.resolveProfile(prepared.selector)))
      return yield* new BatchUpdateRefusedError({
        diagnostic: unknownProfileDiagnostic(prepared.selector),
      });
    return yield* batchCreateOutcome(
      yield* prepared.create({
        reportExcerpts: run.reportExcerpts,
        outcomes: run.outcomes,
        reads: run.reads,
      }),
    );
  }
  return yield* batchCreateOutcome(
    yield* run.noteFeature.createNote(item, {
      reportExcerpts: run.reportExcerpts,
      profile: action.selection?.selector ?? run.profile,
      outcomes: run.outcomes,
      reads: run.reads,
    }),
  );
});

/**
 * A row the run writes nothing for: its Item left Zotero after
 * classification, or its Profile selection stopped and the user never chose.
 */
class BatchRowRefused extends Schema.TaggedError<
  BatchRowRefused,
  { readonly brand: unique symbol }
>()("BatchRowRefused", { message: Schema.String }) {}

/** Note Feature refused a note update; the diagnostic says why. */
export class BatchUpdateRefusedError extends Schema.TaggedError<
  BatchUpdateRefusedError,
  { readonly brand: unique symbol }
>()("BatchUpdateRefusedError", {
  /** Why the update wrote nothing, and what the user can do. */
  diagnostic: Schema.declare(
    (input: unknown): input is NoteOperationDiagnostic =>
      Predicate.isObject(input),
  ),
}) {
  override get message(): string {
    return noteOperationDiagnosticNotice(this.diagnostic);
  }
}

/** Note Feature refused a note create; the diagnostic says why. */
export class BatchCreateRefusedError extends Schema.TaggedError<
  BatchCreateRefusedError,
  { readonly brand: unique symbol }
>()("BatchCreateRefusedError", {
  /** Why the create wrote nothing, and what the user can do. */
  diagnostic: Schema.declare((input: unknown): input is CreateNoteDiagnostic =>
    Predicate.isObject(input),
  ),
}) {
  override get message(): string {
    return createNoteNotice({
      outcome: "refused",
      diagnostic: this.diagnostic,
    });
  }
}

/** A create's row outcome: `created`, or its refusal as the row's failure. */
export function batchCreateOutcome(
  result: CreateNoteResult,
): Effect.Effect<"created", BatchCreateRefusedError> {
  return result.outcome === "refused"
    ? Effect.fail(
        new BatchCreateRefusedError({ diagnostic: result.diagnostic }),
      )
    : Effect.succeed("created");
}

/**
 * Fetch every regular item a target covers and run a batch update. An exact
 * `target` names one Library, optionally narrowed to one collection; no target
 * expands every available Library of the current Library Scope, in canonical
 * order, under this one planning Snapshot. The modal's loading phase shows
 * progress while items are classified, and the user can cancel before the run
 * starts.
 *
 * @param target.groupID names the exact Library the run covers — `0` for
 *   My Library, a positive integer for a group. A group this database doesn't
 *   hold returns `unavailable-target` without scanning.
 * @param target.collectionKey narrows the run to that collection of the named
 *   Library and every collection nested under it. A key that Library doesn't
 *   hold returns `collection-not-found`.
 */
export const runBatchUpdateAll = Effect.fn("runBatchUpdateAll")(function* (
  ports: BatchUpdatePorts,
  target: BatchTarget = {},
) {
  if (!(yield* databaseReady)) {
    yield* Effect.logWarning("Batch update all: database not ready").pipe(
      logged,
    );
    return updateResult({ outcome: "db-unavailable" });
  }

  const plan = yield* planBatchScope("literature-items", target);
  if (plan.outcome !== "resolved")
    return updateResult({ outcome: plan.outcome });

  if (plan.itemIDs.length === 0) {
    return updateResult({ outcome: "empty-selection" });
  }
  return yield* runBatchUpdate(ports, plan.itemIDs, {
    unavailableLibraries: plan.unavailableLibraries,
  });
});

function itemLabel(title: string | null, itemID: number): string {
  return title?.trim() || m.batch_update_untitled({ id: itemID });
}
