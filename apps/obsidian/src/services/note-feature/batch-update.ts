import { chunk } from "@std/collections/chunk";
import { type TFile } from "obsidian";
import pLimit from "p-limit";

import {
  CollectionCache,
  getItemDisplayRefByID,
  getItemRefByID,
  getItemsByID,
  type GroupIDMemo,
} from "@zotlit/db";
import { type NodeDatabaseClient } from "@zotlit/db/client/node";

import { AbortError } from "@/lib/abort-error";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import { formatErrorMessage } from "@/lib/toast";
import * as m from "@/paraglide/messages";
import { type Settings } from "@/services/settings/schema";
import {
  BatchUpdateModal,
  type BatchUpdateClassifyControls,
  type BatchUpdateFailure,
  type BatchUpdateRunControls,
  type BatchUpdateRunResult,
} from "@/views/batch-update-modal";

import { fetchItemCollections, fetchItemTags } from "./context";
import { createNote, type UpdateScope, writeNoteUpdate } from "./operations";
import { type SingleUpdateDeps, updateNote } from "./single-update";

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
  /** How much of each existing note an update refreshes. */
  scope: UpdateScope;
}

/** Ids classified per yield, keeping each synchronous slice short enough that
 * the loading bar paints and Cancel stays responsive between chunks. */
const CLASSIFY_CHUNK_SIZE = 50;

/**
 * Batch-update or create literature notes for `itemIDs`. Owns the
 * database-ready gate, then branches on how many ids the caller asked for:
 *
 * - `0` — nothing to do; show an "item not found" notice.
 * - `1` — route to the single-item {@link updateNote} handler (toast + open),
 *   the nicer single-note UX with no modal.
 * - `≥2` — open the {@link BatchUpdateModal}; classification runs inside it as a
 *   chunked loading phase (see {@link classifyActions}), then confirm → run.
 *
 * Source-id gating happens at the transport edge (URL / HTTP handler) before
 * this is called, so the runner never sees a `sourceId`.
 */
export async function runBatchUpdate(
  deps: SingleUpdateDeps,
  itemIDs: readonly number[],
  scope: UpdateScope = "full",
): Promise<void> {
  if (deps.db.state !== "ready") {
    logger.warn("Batch update: database not ready", { count: itemIDs.length });
    new BaseNotice(m.batch_update_db_unavailable());
    return;
  }

  const [firstID, ...restIDs] = itemIDs;
  if (firstID === undefined) {
    new BaseNotice(m.notice_protocol_item_not_found());
    return;
  }
  if (restIDs.length === 0) {
    // Single id: hand the lightweight ref to updateNote, which owns the full
    // item load on the create path — no need to hydrate it here. The lease is
    // held purely as a refresh gate; updateNote and its helpers re-read
    // deps.db.client, which is safe because no swap can start while it's held.
    using _lease = await deps.db.acquireRead();
    const ref = getItemRefByID(deps.db.client, firstID);
    if (!ref) {
      new BaseNotice(m.notice_protocol_item_not_found());
      return;
    }
    await updateNote(deps, ref, scope);
    return;
  }

  // ≥2 ids: classification is the only synchronous DB work heavy enough to
  // freeze the UI, so it runs inside the modal's loading phase where the bar
  // can paint between chunks; `actions` is captured here for the run callback.
  let actions: BatchAction[] = [];
  new BatchUpdateModal(deps.app, {
    total: itemIDs.length,
    onClassify: async (controls) => {
      const classified = await classifyActions(deps, itemIDs, controls);
      actions = classified.actions;
      return {
        tasks: actions.map(({ itemID, label, kind }) => ({
          id: itemID,
          label,
          kind,
        })),
        notFound: classified.notFound,
      };
    },
    onRun: (controls) =>
      executeBatchActions(deps, { actions, scope }, controls),
  }).open();
}

/**
 * Resolve `itemIDs` into update / create / not-found using one lightweight
 * {@link getItemDisplayRefByID} per id (indexed key + title only, no heavy
 * relational load — that is deferred to each item's write task). Chunked so the
 * synchronous per-id queries yield the main thread before the next slice: this
 * is the one UI-freeze risk in the flow, since `better-sqlite3` is synchronous
 * and a large batch would otherwise block paint and Cancel.
 *
 * @throws when {@link BatchUpdateClassifyControls.signal} aborts (cancel /
 *   dismiss) or a query fails; the modal turns that into a close / notice.
 */
async function classifyActions(
  deps: SingleUpdateDeps,
  itemIDs: readonly number[],
  controls: BatchUpdateClassifyControls,
): Promise<{ actions: BatchAction[]; notFound: NotFoundEntry[] }> {
  // Pin the client for the chunked loop's whole async lifetime so a concurrent
  // refresh cannot swap it out between `await sleep(0)` yields.
  using lease = await deps.db.acquireRead();
  const client = lease.client;
  // Resolve each library's groupID once for the whole classify loop, not per id.
  const groupIdMemo: GroupIDMemo = new Map();
  const actions: BatchAction[] = [];
  const notFound: NotFoundEntry[] = [];
  let classified = 0;
  for (const ids of chunk(itemIDs, CLASSIFY_CHUNK_SIZE)) {
    controls.signal.throwIfAborted();
    for (const itemID of ids) {
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
    classified += ids.length;
    controls.onProgress(classified);
    await sleep(0);
  }

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
  controls: BatchUpdateRunControls,
): Promise<BatchUpdateRunResult> {
  const { actions, scope } = plan;
  // Gate the run once: writeNoteUpdate assumes a ready note index + compiled
  // templates (it skips the per-call awaits updateNote does), and createNote
  // renders through the template service. db readiness is guaranteed by
  // runBatchUpdate's `db.state === "ready"` check.
  const [settings] = await Promise.all([
    deps.settings.loaded,
    deps.noteIndex.ready,
    deps.noteFeatures.template.ready,
  ]);
  const total = actions.length;
  let created = 0;
  let updated = 0;
  const failures: BatchUpdateFailure[] = [];

  // Pin the client for the whole write loop so a concurrent refresh cannot swap
  // it mid-batch (torn snapshot). Acquired after the ready awaits above, which
  // touch settings/index/templates, not the DB.
  using lease = await deps.db.acquireRead();
  // Resolve each library's groupID once across all per-action item loads.
  const run: RunContext = {
    client: lease.client,
    settings,
    groupIdMemo: new Map(),
    collectionCache: new CollectionCache(),
    scope,
  };

  // Each task loads its own full item (deferred from the lightweight
  // classification) right before writing, so the heavy relational read is spread
  // across the async write loop instead of one up-front block. The cap bounds
  // how many run at once.
  const limit = pLimit(32);
  const settled = await Promise.allSettled(
    actions.map((action) =>
      limit(async () => {
        controls.signal.throwIfAborted();
        try {
          await runAction(deps, action, run);
          controls.onItemSettled({ id: action.itemID, status: "done" });
        } catch (error) {
          if (!AbortError.test(error)) {
            controls.onItemSettled({
              id: action.itemID,
              status: "failed",
              failure: {
                label: action.label,
                message: formatErrorMessage(error),
              },
            });
          }
          throw error;
        }
      }),
    ),
  );

  for (const [i, result] of settled.entries()) {
    const action = actions[i]!;
    if (result.status === "fulfilled") {
      if (action.kind === "create") created += 1;
      else updated += 1;
      continue;
    }
    if (AbortError.test(result.reason)) continue;
    logger.warn("Batch update item failed", {
      itemID: action.itemID,
      error: result.reason,
    });
    failures.push({
      label: action.label,
      message: formatErrorMessage(result.reason),
    });
  }

  const failed = failures.length;
  const cancelled =
    controls.signal.aborted && created + updated + failed < total;
  logger.info("Batch update finished", {
    created,
    updated,
    failed,
    cancelled,
    // Every settled result lands in exactly one bucket; the rest were aborted
    // (queued work cancelled before running).
    aborted: total - created - updated - failed,
    total,
  });
  return { created, updated, failed, cancelled, failures };
}

/**
 * Load the action's full item (deferred from classification) and write it: an
 * existing-note update reuses {@link writeNoteUpdate} with freshly-fetched tags;
 * a create routes through the self-contained {@link createNote} (resolves tags +
 * path, then writes — a filename collision surfaces as this item's own
 * `vault.create` failure). An item deleted in Zotero between classification and
 * its write throws here, surfacing as this item's failure (not aborting the run).
 */
async function runAction(
  deps: SingleUpdateDeps,
  action: BatchAction,
  run: RunContext,
): Promise<void> {
  const ctx = deps.noteFeatures;
  const [item] = getItemsByID(run.client, [action.itemID], {
    memo: run.groupIdMemo,
  });
  if (!item)
    throw new Error(m.batch_update_unknown_item({ id: action.itemID }));

  if (action.kind === "update") {
    const itemTags = fetchItemTags(run.client, item);
    const itemCollections = fetchItemCollections(
      run.collectionCache,
      run.client,
      item,
    );
    await writeNoteUpdate(ctx, action.file, {
      item,
      itemTags,
      itemCollections,
      collectionCache: run.collectionCache,
      settings: run.settings,
      scope: run.scope,
    });
    return;
  }
  await createNote(ctx, item, { collectionCache: run.collectionCache });
}

function itemLabel(title: string | null, itemID: number): string {
  return title?.trim() || m.batch_update_untitled({ id: itemID });
}
