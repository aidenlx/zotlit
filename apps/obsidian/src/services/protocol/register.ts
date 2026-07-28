import { type ObsidianProtocolData, type Plugin } from "obsidian";

import { getItemRefByID, type ItemRef } from "@zotlit/db";
import {
  batchProtocolActionId,
  exploreProtocolActionId,
  importManyProtocolActionId,
  importProtocolActionId,
  parseExploreProtocolQuery,
  parseImportManyProtocolQuery,
  parseImportProtocolQuery,
  parseProtocolBatchQuery,
  parseProtocolQuery,
  type ProtocolAction,
  protocolActionId,
  protocolActions,
  protocolSourceMatches,
} from "@zotlit/protocol";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";
import { type LiveUpdateService } from "@/services/live-update/service";
import {
  runBatchUpdate,
  type BatchUpdateResult,
} from "@/services/note-feature/update-batch";
import {
  createAndOpen,
  type SingleUpdateDeps,
  updateNote,
} from "@/services/note-feature/update-single";
import { type BatchImport } from "@/services/note-import/batch-import";
import { batchImportToast } from "@/services/note-import/batch-import-notices";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";
import { openTemplateDataExplorer } from "@/views/template-data-explorer/register";

const logger = getLogger("protocol");

export interface ProtocolDeps extends SingleUpdateDeps {
  batchImport: Pick<BatchImport, "runBatchImport">;
  zoteroPref: ZoteroPrefService;
  liveUpdate: LiveUpdateService;
}

/**
 * Register `obsidian://zotlit/{open,update}` plus the batch `update-many`
 * handler. Each link carries a `source-id` hash the handler validates before
 * delegating to the note-feature service.
 *
 * `update-many` is registered explicitly, outside the per-item loop, because it
 * decodes a different query shape (an item-id list) and routes to the batch
 * runner.
 *
 * Handlers auto-deregister when the plugin unloads.
 */
export function registerProtocolHandlers(
  plugin: Pick<Plugin, "registerObsidianProtocolHandler">,
  deps: ProtocolDeps,
): Disposable {
  using stack = new DisposableStack();
  for (const action of protocolActions) {
    plugin.registerObsidianProtocolHandler(protocolActionId(action), (data) => {
      void handleProtocol(action, data, deps);
    });
  }
  plugin.registerObsidianProtocolHandler(batchProtocolActionId, (data) => {
    void handleBatchProtocol(data, deps);
  });
  plugin.registerObsidianProtocolHandler(importProtocolActionId, (data) => {
    void handleImportProtocol(data, deps);
  });
  plugin.registerObsidianProtocolHandler(importManyProtocolActionId, (data) => {
    void handleImportManyProtocol(data, deps);
  });
  plugin.registerObsidianProtocolHandler(exploreProtocolActionId, (data) => {
    void handleExploreProtocol(data, deps);
  });

  // A batch update pushed over HTTP (companion couldn't fit the ids in a URL)
  // runs the same interactive flow as the `update-many` protocol link.
  stack.defer(
    deps.liveUpdate.on("update-many", (event) => {
      void toast.promise(runBatchUpdate(deps, event.items, event.scope), {
        success: batchUpdateNotice,
      });
    }),
  );

  // A batch import pushed over HTTP runs the same flow as the import-notes link.
  stack.defer(
    deps.liveUpdate.on("import-notes", (event) => {
      void toast.promise(
        deps.batchImport.runBatchImport(event.mode, event.items),
        batchImportToast(),
      );
    }),
  );

  return stack.move();
}

async function handleProtocol(
  action: ProtocolAction,
  data: ObsidianProtocolData,
  deps: ProtocolDeps,
): Promise<void> {
  const query = parseProtocolData(data, deps, {
    action,
    parse: parseProtocolQuery,
  });
  if (!query) return;

  const ref = resolveProtocolItem(query, deps, action);
  if (!ref) return;

  await deps.noteIndex.whenIndexed();

  switch (action) {
    case "open":
      await openNote(deps, ref);
      break;
    case "update":
      await updateNote(deps, ref, query.scope);
      break;
  }
}

/**
 * Handle `obsidian://zotlit/update-many`. Validates the source id at this
 * transport edge, then hands the raw item-id list to {@link runBatchUpdate},
 * which owns the database-ready gate, classification, and the confirm/progress
 * modal.
 */
async function handleBatchProtocol(
  data: ObsidianProtocolData,
  deps: ProtocolDeps,
): Promise<void> {
  const action = "update-many";
  const query = parseProtocolData(data, deps, {
    action,
    parse: parseProtocolBatchQuery,
  });
  if (!query) return;

  await toast.promise(runBatchUpdate(deps, query.items, query.scope), {
    success: batchUpdateNotice,
  });
}

/** Open existing literature note, or create one if none exists. */
async function openNote(deps: ProtocolDeps, ref: ItemRef): Promise<void> {
  const existing = deps.noteIndex.getNotesByItemKey(ref.indexedKey)[0];

  if (existing) {
    await deps.app.workspace.openLinkText(existing.path, "", false, {
      active: true,
    });
    return;
  }

  await createAndOpen(deps, ref);
}

function batchUpdateNotice(result: BatchUpdateResult): string | undefined {
  switch (result.outcome) {
    case "db-unavailable":
      return m.batch_update_db_unavailable();
    case "empty-selection":
    case "not-found":
      return m.notice_protocol_item_not_found();
    default:
      return undefined;
  }
}

/** Handle `obsidian://zotlit/import-note`. */
async function handleImportProtocol(
  data: ObsidianProtocolData,
  deps: ProtocolDeps,
): Promise<void> {
  const action = "import-note";
  const query = parseProtocolData(data, deps, {
    action,
    parse: parseImportProtocolQuery,
  });
  if (!query) return;

  await toast.promise(
    deps.batchImport.runBatchImport(query.mode, [query.item]),
    batchImportToast(),
  );
}

/** Handle `obsidian://zotlit/import-notes`. */
async function handleImportManyProtocol(
  data: ObsidianProtocolData,
  deps: ProtocolDeps,
): Promise<void> {
  const action = "import-notes";
  const query = parseProtocolData(data, deps, {
    action,
    parse: parseImportManyProtocolQuery,
  });
  if (!query) return;

  await toast.promise(
    deps.batchImport.runBatchImport(query.mode, query.items),
    batchImportToast(),
  );
}

async function handleExploreProtocol(
  data: ObsidianProtocolData,
  deps: ProtocolDeps,
): Promise<void> {
  const action = "explore";
  const query = parseProtocolData(data, deps, {
    action,
    parse: parseExploreProtocolQuery,
  });
  if (!query) return;

  const ref = resolveProtocolItem(query, deps, action);
  if (!ref) return;

  await openTemplateDataExplorer(deps.app, {
    itemIndexedKey: ref.indexedKey,
    anchorAnnotationKey: query.annotation,
  });
}

function parseProtocolData<Query extends { sourceId: string }>(
  data: ObsidianProtocolData,
  deps: ProtocolDeps,
  options: {
    action: string;
    parse: (data: Record<string, unknown>) => Query;
  },
): Query | null {
  const { action, parse } = options;

  let query: Query;
  try {
    query = parse(data);
  } catch (error) {
    logger.warn("Invalid protocol query", { action, error });
    new BaseNotice(m.notice_protocol_invalid());
    return null;
  }

  if (!protocolSourceMatches(query, deps.zoteroPref.sourceId)) {
    logger.warn("Protocol source id mismatch", {
      action,
      received: query.sourceId,
      expected: deps.zoteroPref.sourceId,
    });
    return null;
  }

  return query;
}

function resolveProtocolItem(
  query: { item: number },
  deps: ProtocolDeps,
  action: string,
): ItemRef | null {
  if (deps.db.state !== "ready") {
    logger.warn("Protocol handler: database not ready", { action });
    new BaseNotice(m.notice_protocol_db_unavailable());
    return null;
  }

  const ref = getItemRefByID(deps.db.client, query.item);
  if (!ref) {
    logger.warn("Protocol handler: item not found", {
      action,
      itemID: query.item,
    });
    new BaseNotice(m.notice_protocol_item_not_found());
    return null;
  }

  return ref;
}
