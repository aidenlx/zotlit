import { type TFile } from "obsidian";

import {
  CollectionCache,
  getItemDisplayRefByID,
  getItemRefByID,
  getItemsByID,
  type GroupIDMemo,
  type TagMemo,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";

import { getLogger } from "@/lib/log";
import * as m from "@/paraglide/messages";
import {
  type BatchClassifyControls,
  type BatchRunControls,
  type BatchRunResult,
  classifyChunked,
  runBatchWrite,
} from "@/services/batch-run";
import { type Settings } from "@/services/settings/schema";
import { InertTemplateError } from "@/services/template/errors";
import { BatchModal, FlatManifest } from "@/views/batch-modal";

import { type UpdateScope } from "./operations";
import { type SingleUpdateDeps, updateNote } from "./update-single";

const logger = getLogger("batch-update");

type BatchAction =
  | { itemID: number; label: string; kind: "update"; file: TFile }
  | { itemID: number; label: string; kind: "create" };

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
  /** How much of each existing note an update refreshes. */
  scope: UpdateScope;
}

export type BatchUpdateResult =
  | { outcome: "db-unavailable" }
  | { outcome: "empty-selection" }
  | { outcome: "not-found" }
  | { outcome: "single-update" }
  | { outcome: "batch-modal" };

/**
 * Batch-update or create literature notes for `itemIDs`. Owns the
 * database-ready gate, then branches on how many ids the caller asked for:
 *
 * - `0` — nothing to do.
 * - `1` — route to the single-item {@link updateNote} handler (toast + open).
 * - `≥2` — open the {@link BatchModal}; classification runs inside it as a
 *   chunked loading phase (see {@link classifyActions}), then confirm → run.
 *
 * Returns a discriminated result so the caller can map outcomes to UI feedback
 * (notice / toast) without coupling the logic to presentation.
 */
export async function runBatchUpdate(
  deps: SingleUpdateDeps,
  itemIDs: readonly number[],
  scope: UpdateScope = "full",
): Promise<BatchUpdateResult> {
  if (deps.db.state !== "ready") {
    logger.warn("Batch update: database not ready", { count: itemIDs.length });
    return { outcome: "db-unavailable" };
  }

  const [firstID, ...restIDs] = itemIDs;
  if (firstID === undefined) {
    return { outcome: "empty-selection" };
  }

  await deps.noteIndex.whenIndexed();
  if (restIDs.length === 0) {
    // Single id: hand the lightweight ref to updateNote, which owns the full
    // item load on the create path — no need to hydrate it here. The lease pins
    // the client for this ref load; the downstream updateNote re-acquires its
    // own lease and threads that client through its write + flush.
    using lease = await deps.db.acquireRead();
    const ref = getItemRefByID(lease.client, firstID);
    if (!ref) {
      return { outcome: "not-found" };
    }
    await updateNote(deps, ref, scope);
    return { outcome: "single-update" };
  }

  // ≥2 ids: classification is the only synchronous DB work heavy enough to
  // freeze the UI, so it runs inside the modal's loading phase where the bar
  // can paint between chunks; `actions` is captured here for the run callback.
  let actions: BatchAction[] = [];
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
        actionable === 0
          ? m.batch_update_confirm_none({ count: notFound })
          : m.batch_update_confirm_intro({ count: actionable }),
      confirmButton: m.batch_update_confirm_button(),
      runSummary: (result, state) =>
        state.aborted
          ? m.batch_update_aborted(result)
          : state.cancelled
            ? m.batch_update_summary_cancelled(result)
            : m.batch_update_summary(result),
    },
    total: itemIDs.length,
    onClassify: async (controls) => {
      const classified = await classifyActions(deps, itemIDs, controls);
      actions = classified.actions;
      return new FlatManifest({
        tasks: actions.map(({ itemID, label, kind }) => ({
          id: itemID,
          label,
          kind,
        })),
        notFound: classified.notFound,
        groups: [
          { kind: "update", header: m.batch_update_group_update },
          { kind: "create", header: m.batch_update_group_create },
        ],
        notFoundHeader: m.batch_update_group_not_found,
        abortedHeader: m.batch_update_group_aborted,
      });
    },
    onRun: (controls) =>
      executeBatchActions(deps, { actions, scope }, controls),
  }).open();
  return { outcome: "batch-modal" };
}

/**
 * Resolve `itemIDs` into update / create / not-found using one lightweight
 * {@link getItemDisplayRefByID} per id (indexed key + title only, no heavy
 * relational load — that is deferred to each item's write task). Chunked so the
 * synchronous per-id queries yield the main thread before the next slice: this
 * is the one UI-freeze risk in the flow, since `better-sqlite3` is synchronous
 * and a large batch would otherwise block paint and Cancel.
 *
 * @throws when {@link BatchClassifyControls.signal} aborts (cancel /
 *   dismiss) or a query fails; the modal turns that into a close / notice.
 */
async function classifyActions(
  deps: SingleUpdateDeps,
  itemIDs: readonly number[],
  controls: BatchClassifyControls,
): Promise<{ actions: BatchAction[]; notFound: NotFoundEntry[] }> {
  // Pin the client for the chunked loop's whole async lifetime so a concurrent
  // refresh cannot swap it out between `await sleep(0)` yields.
  using lease = await deps.db.acquireRead();
  const client = lease.client;
  const groupIdMemo: GroupIDMemo = new Map();
  const actions: BatchAction[] = [];
  const notFound: NotFoundEntry[] = [];
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
      const file = deps.noteIndex.getNotesByItemKey(ref.indexedKey)[0];
      const label = itemLabel(ref.title, itemID);
      if (file) {
        actions.push({ itemID, label, kind: "update", file });
      } else {
        actions.push({ itemID, label, kind: "create" });
      }
    }
  });

  logger.info("Batch update classified", () => {
    const { update = [], create = [] } = Object.groupBy(actions, (t) => t.kind);
    return {
      total: itemIDs.length,
      update: update.length,
      create: create.length,
      notFound: notFound.length,
    };
  });
  return { actions, notFound };
}

async function executeBatchActions(
  deps: SingleUpdateDeps,
  plan: { actions: readonly BatchAction[]; scope: UpdateScope },
  controls: BatchRunControls,
): Promise<BatchRunResult> {
  const { actions, scope } = plan;
  const [settings] = await Promise.all([
    deps.settings.loaded,
    deps.noteFeature.ready,
  ]);

  // Per-run caches + scope span the whole batch; only `client` varies per call
  // (threaded from the pinned lease), so build the invariant context once.
  const baseContext: Omit<RunContext, "client"> = {
    settings,
    groupIdMemo: new Map(),
    collectionCache: new CollectionCache(),
    tagMemo: new Map(),
    scope,
  };

  const result = await runBatchWrite({
    db: deps.db,
    tasks: actions.map((a) => ({ ...a, id: a.itemID })),
    controls,
    concurrency: 32,
    run: async (task, client) => {
      await runAction(deps, task, { ...baseContext, client });
      return task.kind === "create" ? "created" : "updated";
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
): Promise<void> {
  const [item] = getItemsByID(run.client, [action.itemID], {
    memo: run.groupIdMemo,
  });
  if (!item)
    throw new Error(m.batch_update_unknown_item({ id: action.itemID }));

  if (action.kind === "update") {
    await deps.noteFeature.writeNoteUpdate(action.file, {
      client: run.client,
      item,
      tagMemo: run.tagMemo,
      collectionCache: run.collectionCache,
      settings: run.settings,
      scope: run.scope,
      groupIdMemo: run.groupIdMemo,
    });
    return;
  }
  await deps.noteFeature.createNote(item, {
    collectionCache: run.collectionCache,
    tagMemo: run.tagMemo,
    groupIdMemo: run.groupIdMemo,
  });
}

function itemLabel(title: string | null, itemID: number): string {
  return title?.trim() || m.batch_update_untitled({ id: itemID });
}
