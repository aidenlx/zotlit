import type { ObsidianProtocolData, Plugin } from "obsidian";

import { getItemRefByID } from "@zotlit/db";
import type { ItemRef } from "@zotlit/db";
import {
  batchProtocolActionId,
  exploreProtocolActionId,
  importAllNotesProtocolActionId,
  importManyProtocolActionId,
  importProtocolActionId,
  parseExploreProtocolQuery,
  parseImportAllNotesProtocolQuery,
  parseImportManyProtocolQuery,
  parseImportProtocolQuery,
  parseProtocolBatchQuery,
  parseProtocolQuery,
  parseUpdateAllProtocolQuery,
  protocolActionId,
  protocolActions,
  protocolSourceMatches,
  updateAllProtocolActionId,
} from "@zotlit/protocol";
import type { ProtocolAction } from "@zotlit/protocol";

import * as m from "@/lib/i18n/generated/messages";
import { getLogger } from "@/lib/log";
import { BaseNotice } from "@/lib/notice";
import {
  parseProfileSelector,
  unknownProfileDiagnostic,
} from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import * as toast from "@/lib/toast";
import type { LiveUpdateService } from "@/services/live-update/service";
import {
  runBatchUpdate,
  runBatchUpdateAll,
} from "@/services/note-feature/update-batch";
import type { BatchUpdateResult } from "@/services/note-feature/update-batch";
import {
  createAndOpen,
  noteOperationDiagnosticNotice,
  resolveLiteratureNoteWithWarning,
  updateNote,
} from "@/services/note-feature/update-single";
import type { SingleUpdateDeps } from "@/services/note-feature/update-single";
import type { BatchImport } from "@/services/note-import/batch-import";
import {
  batchImportAllToast,
  batchImportToast,
} from "@/services/note-import/batch-import-notices";
import { noteProfileSelector } from "@/services/profile/bindings";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import { openTemplateDataExplorer } from "@/views/template-data-explorer/register";

const logger = getLogger("protocol");

export interface ProtocolDeps extends SingleUpdateDeps {
  batchImport: Pick<BatchImport, "runBatchImport" | "runBatchImportAll">;
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
  plugin.registerObsidianProtocolHandler(updateAllProtocolActionId, (data) => {
    void handleUpdateAllProtocol(data, deps);
  });
  plugin.registerObsidianProtocolHandler(
    importAllNotesProtocolActionId,
    (data) => {
      void handleImportAllNotesProtocol(data, deps);
    },
  );

  // A batch update pushed over HTTP (companion couldn't fit the ids in a URL)
  // runs the same interactive flow as the `update-many` protocol link.
  stack.defer(
    deps.liveUpdate.on("update-many", (event) => {
      const requested = resolveRequestedProfile(event.profileId);
      if (!requested.ok) return;
      void toast.promise(
        runBatchUpdate(deps, event.items, {
          scope: event.scope,
          profile: requested.selector,
        }),
        { success: batchUpdateNotice },
      );
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

  const requested = resolveRequestedProfile(query.profileId);
  if (!requested.ok) return;

  await deps.noteIndex.whenIndexed();

  switch (action) {
    case "open":
      await openNote(deps, ref, requested.selector);
      break;
    case "update":
      await updateNote(deps, ref, {
        scope: query.scope,
        profile: requested.selector,
      });
      break;
  }
}

/**
 * A `profileId` param resolved into a selector. `ok: false` means the text
 * named neither `default` nor a Profile ID — the caller already surfaced the
 * unknown-Profile notice and must stop rather than fall back to the default.
 */
type RequestedProfile =
  | { readonly ok: true; readonly selector: ProfileSelector | undefined }
  | { readonly ok: false };

function resolveRequestedProfile(text: string | undefined): RequestedProfile {
  if (text === undefined) return { ok: true, selector: undefined };
  const selector = parseProfileSelector(text);
  if (selector === undefined) {
    new BaseNotice(
      noteOperationDiagnosticNotice(unknownProfileDiagnostic(text)),
    );
    return { ok: false };
  }
  return { ok: true, selector };
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

  const requested = resolveRequestedProfile(query.profileId);
  if (!requested.ok) return;

  await toast.promise(
    runBatchUpdate(deps, query.items, {
      scope: query.scope,
      profile: requested.selector,
    }),
    {
      success: batchUpdateNotice,
    },
  );
}

/** Open existing literature note, or create one if none exists. */
async function openNote(
  deps: ProtocolDeps,
  ref: ItemRef,
  profile?: ProfileSelector,
): Promise<void> {
  const existing = resolveLiteratureNoteWithWarning(
    deps.noteIndex.getNotesByItemKey(ref.indexedKey),
  );

  if (existing) {
    await deps.profile.ready;
    const resolved = deps.profile.profileOf(existing);
    const existingSelector = noteProfileSelector(resolved);
    if (profile !== undefined && profile !== existingSelector) {
      new BaseNotice(m.notice_literature_note_profile_conflict());
      return;
    }
    await deps.app.workspace.openLinkText(existing.path, "", false, {
      active: true,
    });
    return;
  }

  await createAndOpen(deps, ref, profile);
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

async function handleUpdateAllProtocol(
  data: ObsidianProtocolData,
  deps: ProtocolDeps,
): Promise<void> {
  const query = parseProtocolData(data, deps, {
    action: "update-all",
    parse: parseUpdateAllProtocolQuery,
  });
  if (!query) return;

  await toast.promise(
    runBatchUpdateAll(deps, {
      groupID: query.groupID,
      collectionKey: query.collectionKey,
    }),
    { success: updateAllNotice },
  );
}

/** Handle `obsidian://zotlit/import-all-notes`. */
async function handleImportAllNotesProtocol(
  data: ObsidianProtocolData,
  deps: ProtocolDeps,
): Promise<void> {
  const query = parseProtocolData(data, deps, {
    action: "import-all-notes",
    parse: parseImportAllNotesProtocolQuery,
  });
  if (!query) return;

  await toast.promise(
    deps.batchImport.runBatchImportAll({
      groupID: query.groupID,
      collectionKey: query.collectionKey,
    }),
    batchImportAllToast(),
  );
}

function updateAllNotice(result: BatchUpdateResult): string | undefined {
  switch (result.outcome) {
    case "db-unavailable":
      return m.batch_update_db_unavailable();
    case "empty-selection":
      return m.batch_update_all_empty();
    case "no-library-in-scope":
      return m.batch_all_no_library_in_scope();
    case "unavailable-target":
      return m.batch_all_library_unavailable();
    case "collection-not-found":
      return m.notice_collection_not_found();
    default:
      return undefined;
  }
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
