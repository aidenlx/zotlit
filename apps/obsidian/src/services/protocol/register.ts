import { type ObsidianProtocolData, type Plugin } from "obsidian";

import { getItemRefByID, type ItemRef } from "@zotlit/db";
import {
  batchProtocolActionId,
  getProtocolUrlVersion,
  importManyProtocolActionId,
  importProtocolActionId,
  type ImportManyProtocolQuery,
  type ImportProtocolQuery,
  parseImportManyProtocolQuery,
  parseImportProtocolQuery,
  parseProtocolBatchQuery,
  parseProtocolQuery,
  type ProtocolAction,
  protocolActionId,
  protocolActions,
  type ProtocolBatchQuery,
  protocolSourceMatches,
  type ProtocolQuery,
} from "@zotlit/protocol";

import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";
import * as m from "@/paraglide/messages";
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
import {
  batchImportToast,
  runBatchImport,
  type NoteImportContext,
} from "@/services/note-import/batch-import";
import { rejectIncompatibleProtocol } from "@/services/protocol/compat";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

const logger = getLogger("protocol");

export interface ProtocolDeps extends SingleUpdateDeps, NoteImportContext {
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
        runBatchImport(deps, event.mode, event.items),
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
  if (
    rejectIncompatibleProtocol(getProtocolUrlVersion(data), logger, {
      action,
      transport: "url",
    })
  ) {
    return;
  }

  let query: ProtocolQuery;
  try {
    query = parseProtocolQuery(data);
  } catch (error) {
    logger.warn("Invalid protocol query", { action, error });
    new BaseNotice(m.notice_protocol_invalid());
    return;
  }

  if (!protocolSourceMatches(query, deps.zoteroPref.sourceId)) {
    logger.warn("Protocol source id mismatch", {
      action,
      received: query.sourceId,
      expected: deps.zoteroPref.sourceId,
    });
    return;
  }

  if (deps.db.state !== "ready") {
    logger.warn("Protocol handler: database not ready", { action });
    new BaseNotice(m.notice_protocol_db_unavailable());
    return;
  }

  const ref = getItemRefByID(deps.db.client, query.item);
  if (!ref) {
    logger.warn("Protocol handler: item not found", {
      action,
      itemID: query.item,
    });
    new BaseNotice(m.notice_protocol_item_not_found());
    return;
  }

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
 * Handle `obsidian://zotlit/update-many`. Validates protocol version and
 * source id at this transport edge, then hands the raw item-id list to
 * {@link runBatchUpdate}, which owns the database-ready gate, classification,
 * and the confirm/progress modal.
 */
async function handleBatchProtocol(
  data: ObsidianProtocolData,
  deps: ProtocolDeps,
): Promise<void> {
  const action = "update-many";
  if (
    rejectIncompatibleProtocol(getProtocolUrlVersion(data), logger, {
      action,
      transport: "url",
    })
  ) {
    return;
  }

  let query: ProtocolBatchQuery;
  try {
    query = parseProtocolBatchQuery(data);
  } catch (error) {
    logger.warn("Invalid protocol query", { action, error });
    new BaseNotice(m.notice_protocol_invalid());
    return;
  }

  if (!protocolSourceMatches(query, deps.zoteroPref.sourceId)) {
    logger.warn("Protocol source id mismatch", {
      action,
      received: query.sourceId,
      expected: deps.zoteroPref.sourceId,
    });
    return;
  }

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
  if (
    rejectIncompatibleProtocol(getProtocolUrlVersion(data), logger, {
      action,
      transport: "url",
    })
  ) {
    return;
  }

  let query: ImportProtocolQuery;
  try {
    query = parseImportProtocolQuery(data);
  } catch (error) {
    logger.warn("Invalid protocol query", { action, error });
    new BaseNotice(m.notice_protocol_invalid());
    return;
  }

  if (!protocolSourceMatches(query, deps.zoteroPref.sourceId)) {
    logger.warn("Protocol source id mismatch", {
      action,
      received: query.sourceId,
      expected: deps.zoteroPref.sourceId,
    });
    return;
  }

  await toast.promise(
    runBatchImport(deps, query.mode, [query.item]),
    batchImportToast(),
  );
}

/** Handle `obsidian://zotlit/import-notes`. */
async function handleImportManyProtocol(
  data: ObsidianProtocolData,
  deps: ProtocolDeps,
): Promise<void> {
  const action = "import-notes";
  if (
    rejectIncompatibleProtocol(getProtocolUrlVersion(data), logger, {
      action,
      transport: "url",
    })
  ) {
    return;
  }

  let query: ImportManyProtocolQuery;
  try {
    query = parseImportManyProtocolQuery(data);
  } catch (error) {
    logger.warn("Invalid protocol query", { action, error });
    new BaseNotice(m.notice_protocol_invalid());
    return;
  }

  if (!protocolSourceMatches(query, deps.zoteroPref.sourceId)) {
    logger.warn("Protocol source id mismatch", {
      action,
      received: query.sourceId,
      expected: deps.zoteroPref.sourceId,
    });
    return;
  }

  await toast.promise(
    runBatchImport(deps, query.mode, query.items),
    batchImportToast(),
  );
}
