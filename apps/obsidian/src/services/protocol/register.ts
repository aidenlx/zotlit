import { type App, type ObsidianProtocolData, type Plugin } from "obsidian";

import { getItemRefByID, getItemsByID, type ItemRef } from "@zotlit/db";
import {
  getProtocolUrlVersion,
  parseProtocolQuery,
  type ProtocolAction,
  protocolActionId,
  protocolActions,
  protocolSourceMatches,
  type ProtocolQuery,
} from "@zotlit/protocol";

import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import * as toast from "@/lib/toast";
import * as m from "@/paraglide/messages";
import { type DatabaseService } from "@/services/database/service";
import { EmptyFilenameError } from "@/services/note-feature/filename";
import { type NoteFeatures } from "@/services/note-feature/service";
import { itemKeyFromFrontmatter } from "@/services/note-index/service";
import { type NoteIndex } from "@/services/note-index/service";
import { rejectIncompatibleProtocol } from "@/services/protocol/compat";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

const logger = getLogger("protocol");

export interface ProtocolDeps {
  app: App;
  db: DatabaseService;
  zoteroPref: ZoteroPrefService;
  noteFeatures: NoteFeatures;
  noteIndex: NoteIndex;
}

/**
 * Register `obsidian://zotlit/{open,update}` handlers. Each link carries a
 * numeric `itemID` and a `source-id` hash; the handler validates both before
 * delegating to {@link NoteFeatures}.
 *
 * Handlers auto-deregister when the plugin unloads.
 */
export function registerProtocolHandlers(
  plugin: Pick<Plugin, "registerObsidianProtocolHandler">,
  deps: ProtocolDeps,
): void {
  for (const action of protocolActions) {
    plugin.registerObsidianProtocolHandler(protocolActionId(action), (data) => {
      void handleProtocol(action, data, deps);
    });
  }
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

  switch (action) {
    case "open":
      await openNote(deps, ref);
      break;
    case "update":
      await updateNote(deps, ref);
      break;
  }
}

/** Open existing literature note, or create one if none exists. */
async function openNote(deps: ProtocolDeps, ref: ItemRef): Promise<void> {
  const existing = deps.noteIndex.getNotesByItemKey(ref.indexedKey).sort()[0];

  if (existing) {
    await deps.app.workspace.openLinkText(existing, "", false, {
      active: true,
    });
    return;
  }

  await createAndOpen(deps, ref);
}

/** Update the existing literature note, or create if none exists. */
async function updateNote(deps: ProtocolDeps, ref: ItemRef): Promise<void> {
  const existing = deps.noteIndex.getNotesByItemKey(ref.indexedKey).sort()[0];

  if (!existing) {
    await createAndOpen(deps, ref);
    return;
  }

  const file = deps.app.vault.getFileByPath(existing);
  if (!file) return;

  const itemKey = itemKeyFromFrontmatter(
    deps.app.metadataCache.getFileCache(file),
  );
  if (!itemKey) return;

  void toast.promise(deps.noteFeatures.update(file, itemKey), {
    loading: m.notice_updating_note(),
    success: (result) =>
      result.bodyUpdated
        ? m.notice_updated_note()
        : m.notice_updated_note_no_region(),
    error: m.notice_update_note_failed(),
  });
}

/** Lazily resolve the full Item and create + open a new literature note. */
async function createAndOpen(deps: ProtocolDeps, ref: ItemRef): Promise<void> {
  const [item] = getItemsByID(deps.db.client, ref.libraryID, [ref.itemID]);
  if (!item) return;

  try {
    const file = await toast.promise(deps.noteFeatures.create(item), {
      loading: m.notice_creating_note(),
      success: m.notice_created_note(),
      error: (_msg, e) =>
        e instanceof EmptyFilenameError
          ? e.message
          : m.notice_create_note_failed(),
      swallowError: false,
    });
    await deps.app.workspace.openLinkText(file.path, "", false, {
      active: true,
    });
  } catch {
    // toast.promise already surfaced the failure.
  }
}
