import type { TFile } from "obsidian";

import {
  CollectionCache,
  getZoteroIdentity,
  getItemDisplayRefByID,
  getItemRefByID,
  getItemsByID,
} from "@zotlit/db";
import type { GroupIDMemo, TagMemo, Item } from "@zotlit/db";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import type { ProfileSelector } from "@/lib/profile-stamp";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import { chooseBatchProfile } from "@/services/batch-profile-choice";
import type { BatchProfilePickerDeps } from "@/services/batch-profile-choice";
import { batchProfileSummary } from "@/services/batch-profile-summary";
import type { BatchProfileCount } from "@/services/batch-profile-summary";
import { classifyChunked, runBatchWrite } from "@/services/batch-run";
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
import type { ResolvedProfile } from "@/services/profile/bindings";
import type { Settings } from "@/services/settings/schema";
import { InertTemplateError } from "@/services/template/errors";
import { BatchModal, FlatManifest } from "@/views/batch-modal";
import type { BatchProfileChoice, FlatTask } from "@/views/batch-modal";

import type {
  CreateNoteDiagnostic,
  CreateNoteResult,
  NoteOperationDiagnostic,
  UpdateScope,
  CreationProfileSelection,
  PreparedCreationProfile,
} from "./operations";
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

type BatchAction = {
  itemID: number;
  indexedKey: string;
  label: string;
  libraryID: number;
  profile?: ResolvedProfile;
  unknownStamp?: string;
} & (
  | { kind: "update"; file: TFile }
  | { kind: "create"; prepared?: PreparedCreationProfile }
);

interface NotFoundEntry {
  itemID: number;
  label: string;
}

/** Lease-scoped state shared across a run's per-action item loads. */
interface RunContext {
  client: NodeDatabaseClient;
  settings: Readonly<Settings>;
  groupIdMemo: GroupIDMemo;
  /** Spans the whole batch so per-library collection nodes load once. */
  collectionCache: CollectionCache;
  /** Spans the whole batch so a shared item's tags load once. */
  tagMemo: TagMemo;
  /**
   * Signed-in account username, resolved once for the whole batch.
   *
   * @see docs/adr/0009-weblink-is-the-web-url-not-the-item-uri.md
   */
  username: string | null;
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
    // item load on the create path — no need to hydrate it here. The lease pins
    // the client for this ref load; the downstream updateNote re-acquires its
    // own lease and threads that client through its write + flush.
    using lease = await deps.db.acquireRead();
    const ref = getItemRefByID(lease.client, firstID);
    if (!ref) {
      return { outcome: "not-found" };
    }
    await updateNote(deps, ref, { scope, profile });
    return { outcome: "single-update" };
  }

  // ≥2 ids: classification is the only synchronous DB work heavy enough to
  // freeze the UI, so it runs inside the modal's loading phase where the bar
  // can paint between chunks; `actions` is captured here for the run callback.
  let actions: BatchAction[] = [];
  let selection: CreationProfileSelection | undefined;
  let creationItems: Item[] = [];
  let plans: ReadonlyMap<number, readonly PreparedCreationProfile[]> =
    new Map();
  let tasks: FlatTask[] = [];
  let keptCount = 0;
  let notFoundCount = 0;
  const profileCounts = new Map<ProfileSelector, BatchProfileCount>();
  const applySelection = (selector: ProfileSelector) => {
    const resolved = deps.profile.resolveProfile(selector)!;
    for (const action of actions) {
      if (action.kind !== "create") continue;
      action.prepared = plans
        .get(action.itemID)
        ?.find((entry) => entry.selector === selector);
      action.profile = resolved;
      const task = tasks.find((entry) => entry.id === action.itemID);
      if (task)
        Object.assign(task, {
          path: action.prepared?.path,
          reason: action.prepared?.unavailable,
          profile: profileLabel(resolved),
        });
    }
  };
  new BatchModal(deps.app, {
    text: {
      title: m.batch_update_title(),
      loadingLabel: m.batch_update_loading_label(),
      loadFailed: m.batch_update_load_failed(),
      runFailed: (error) =>
        error instanceof InertTemplateError
          ? error.message
          : m.batch_update_run_failed(),
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
      let profileChoice: BatchProfileChoice | undefined;
      if (
        profilesEnabled &&
        actions.some((action) => action.kind === "create")
      ) {
        selection = await deps.noteFeature.resolveCreationProfile({
          headless: profile,
        });
        {
          using lease = await deps.db.acquireRead();
          creationItems = getItemsByID(
            lease.client,
            actions
              .filter((action) => action.kind === "create")
              .map((action) => action.itemID),
          );
        }
        plans = await deps.noteFeature.prepareBatchCreationProfiles(
          creationItems,
          { signal: controls.signal },
        );
        applySelection(selection.selector);
        profileChoice = {
          get label() {
            return profileLabel(
              deps.profile.resolveProfile(selection!.selector)!,
            );
          },
          get source() {
            return selection!.source;
          },
          choose: async () => {
            const first = creationItems[0];
            if (!first) return;
            if (
              deps.profile.profiles.some(
                ({ id }) =>
                  !plans
                    .get(first.itemID)
                    ?.some((entry) => entry.selector === id),
              )
            ) {
              plans =
                await deps.noteFeature.prepareBatchCreationProfiles(
                  creationItems,
                );
            }
            const chosen = await chooseBatchProfile(deps, {
              indexedKey: first.indexedKey,
              selection: selection!,
              previews: plans.get(first.itemID) ?? [],
            });
            if (chosen === undefined) return;
            if (
              !plans
                .get(first.itemID)
                ?.some((entry) => entry.selector === chosen)
            ) {
              plans =
                await deps.noteFeature.prepareBatchCreationProfiles(
                  creationItems,
                );
            }
            applySelection(chosen);
            selection = { selector: chosen, source: "asked", shouldAsk: true };
            logger.debug("Changed batch creation Profile", {
              selector: chosen,
              items: creationItems.length,
            });
          },
        };
      }
      tasks = actions.map((action) => ({
        id: action.itemID,
        label: action.label,
        kind: batchGroupKey(action.libraryID, action.kind),
        ...(profilesEnabled
          ? {
              profile: action.profile
                ? profileLabel(action.profile)
                : action.unknownStamp,
              ...(action.kind === "create"
                ? {
                    path: action.prepared?.path,
                    reason: action.prepared?.unavailable,
                  }
                : {}),
            }
          : {}),
      }));
      return new FlatManifest({
        tasks,
        notFound: classified.notFound,
        groups: batchGroups(classified.libraries, [
          { kind: "update", header: m.batch_update_group_update },
          {
            kind: "create",
            header: m.batch_update_group_create,
            profileChoice,
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
    onRun: (controls) => {
      if (selection)
        deps.settings.update({ "note.last-used-profile": selection.selector });
      return executeBatchActions(
        deps,
        {
          actions,
          scope,
          profile: selection?.selector ?? profile,
          profileCounts: profilesEnabled ? profileCounts : undefined,
        },
        controls,
      );
    },
  }).open();
  return { outcome: "batch-modal" };
}

/**
 * Resolve `itemIDs` into update / create / skipped / not-found using one
 * lightweight {@link getItemDisplayRefByID} per id (indexed key + title only, no
 * heavy relational load — that is deferred to each item's write task). Chunked so
 * the synchronous per-id queries yield the main thread before the next slice:
 * this is the one UI-freeze risk in the flow, since `better-sqlite3` is
 * synchronous and a large batch would otherwise block paint and Cancel.
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
  // Pin the client for the chunked loop's whole async lifetime so a concurrent
  // refresh cannot swap it out between `yieldToMain()` yields.
  using lease = await deps.db.acquireRead();
  const client = lease.client;
  const groupIdMemo: GroupIDMemo = new Map();
  const actions: BatchAction[] = [];
  const skipped: NotFoundEntry[] = [];
  const notFound: NotFoundEntry[] = [];
  const kept: { label: string; profile: string; reason: string }[] = [];
  await classifyChunked(itemIDs, controls, (slice) => {
    for (const itemID of slice) {
      const ref = getItemDisplayRefByID(client, itemID, { memo: groupIdMemo });
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
  });

  const libraries = batchLibraries(
    client,
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
  const [settings] = await Promise.all([
    deps.settings.loaded,
    deps.noteFeature.ready,
  ]);

  // Per-run caches + scope span the whole batch; `client` and `username` are
  // run-invariant too but only available inside the run closure, so they're
  // passed per call instead of baked in here.
  const baseContext: Omit<RunContext, "client" | "username"> = {
    settings,
    groupIdMemo: new Map(),
    collectionCache: new CollectionCache(),
    tagMemo: new Map(),
    scope,
    profile,
  };

  // The signed-in username is an account-wide scalar, resolved once under the
  // batch's own read lease (the client `runBatchWrite` pins) rather than via a
  // separate lease a refresh could swap. `undefined` marks it unresolved —
  // unreachable as a `getZoteroIdentity` result — so the first task resolves it
  // and the rest reuse the value.
  let username: string | null | undefined;

  const result = await runBatchWrite({
    db: deps.db,
    tasks: actions.map((a) => ({ ...a, id: a.itemID })),
    controls,
    concurrency: 32,
    run: async (task, client) => {
      if (username === undefined) username = getZoteroIdentity(client).username;
      const outcome = await runAction(deps, task, {
        ...baseContext,
        client,
        username,
      });
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
 * existing-note update reuses {@link writeNoteUpdate}, sharing the batch's
 * `tagMemo`/`collectionCache`; a create routes through the self-contained
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
  const [item] = getItemsByID(run.client, [action.itemID], {
    memo: run.groupIdMemo,
  });
  if (!item)
    throw new Error(m.batch_update_unknown_item({ id: action.itemID }));

  if (action.kind === "update") {
    const result = await deps.noteFeature.writeNoteUpdate(action.file, {
      client: run.client,
      item,
      tagMemo: run.tagMemo,
      collectionCache: run.collectionCache,
      settings: run.settings,
      scope: run.scope,
      groupIdMemo: run.groupIdMemo,
      username: run.username,
    });
    if (result.diagnostic) {
      throw new BatchUpdateRefusedError(result.diagnostic);
    }
    return "updated";
  }
  if (action.prepared)
    return batchCreateOutcome(await action.prepared.create());
  const result = await deps.noteFeature.createNote(item, {
    collectionCache: run.collectionCache,
    tagMemo: run.tagMemo,
    groupIdMemo: run.groupIdMemo,
    username: run.username,
    profile: run.profile,
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
