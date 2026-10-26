import { Cause, Data, Effect, Fiber, FiberSet, Scope } from "effect";
import type { ManagedRuntime } from "effect";
import type { ObsidianProtocolData, PaneType, Plugin } from "obsidian";

import type { ItemRef } from "@zotlit/db";
import {
  batchProtocolActionId,
  exploreProtocolActionId,
  importAllNotesProtocolActionId,
  importManyProtocolActionId,
  importProtocolActionId,
  importProfileProtocolActionId,
  openAttachmentProtocolActionId,
  parseImportProfileProtocolQuery,
  parseExploreProtocolQuery,
  parseImportAllNotesProtocolQuery,
  parseImportManyProtocolQuery,
  parseImportProtocolQuery,
  parseOpenAttachmentProtocolQuery,
  parseProtocolBatchQuery,
  parseProtocolQuery,
  parseUpdateAllProtocolQuery,
  protocolActionId,
  protocolActions,
  protocolSourceMatches,
  updateAllProtocolActionId,
} from "@zotlit/protocol";
import type { ProtocolAction } from "@zotlit/protocol";

import { openAttachments, withFixedPane } from "@/lib/attachment-open";
import type { AttachmentReader } from "@/lib/attachment-open";
import type { EffectBridge } from "@/lib/effect-bridge";
import { logAndContinue, withLogCategory } from "@/lib/effect-log";
import { openScope } from "@/lib/effect-scope";
import { forkEach } from "@/lib/effect-stream";
import * as m from "@/lib/i18n/generated/messages";
import { Notifier, reportOutcome } from "@/lib/notifier";
import type { NoticeMessage, OutcomeCopy } from "@/lib/notifier";
import { ObsidianEnv } from "@/lib/obsidian-env";
import { Vault } from "@/lib/obsidian-vault";
import { Workspace } from "@/lib/obsidian-workspace";
import {
  parseProfileSelector,
  unknownProfileDiagnostic,
} from "@/lib/profile-stamp";
import type { ProfileSelector } from "@/lib/profile-stamp";
import * as toast from "@/lib/toast";
import {
  pdfPickerReader,
  toObsidianOpenable,
} from "@/services/attachment-open/actions";
import type { TargetOpener } from "@/services/attachment-open/open-target";
import type { ObsidianOpenableAttachment } from "@/services/attachment-open/resolve";
import { LocalServer } from "@/services/local-server/service";
import type {
  ImportNotesRequest,
  UpdateManyRequest,
} from "@/services/local-server/service";
import { openCompanionNote } from "@/services/note-feature";
import type { CompanionNoteDeps } from "@/services/note-feature";
import {
  runBatchUpdate,
  runBatchUpdateAll,
} from "@/services/note-feature/update-batch";
import type {
  BatchUpdatePorts,
  BatchUpdateResult,
  BatchUpdateServices,
} from "@/services/note-feature/update-batch";
import { noteOperationDiagnosticNotice } from "@/services/note-feature/update-single";
import {
  runBatchImport,
  runBatchImportAll,
} from "@/services/note-import/batch-import";
import type {
  BatchImportPorts,
  BatchImportServices,
} from "@/services/note-import/batch-import";
import {
  batchImportAllToast,
  batchImportToast,
} from "@/services/note-import/batch-import-notices";
import type { NoteImportView } from "@/services/note-import/view";
import type { UseLedger } from "@/services/use-ledger/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import { readDisplayRef } from "@/services/zotero-reads/display-ref";
import { ZoteroReads } from "@/services/zotero-reads/service";
import { openTemplateDataExplorer } from "@/views/template-data-explorer/register";
import { openTemplateWorkbench } from "@/views/template-workbench/register";

/** The services a protocol handler reads through their tags. */
export type ProtocolServices =
  | BatchImportServices
  | BatchUpdateServices
  | LocalServer
  | Notifier
  | ObsidianEnv
  | UseLedger
  | Vault
  | Workspace
  | ZoteroPref
  | ZoteroReads;

/**
 * The legacy values the handlers still hold. Note Feature, the Profile
 * factories and the Attachment opener convert in later slices.
 */
export interface ProtocolDeps extends CompanionNoteDeps {
  noteFeature: CompanionNoteDeps["noteFeature"] &
    BatchUpdatePorts["noteFeature"] &
    BatchImportPorts["noteFeature"];
  webWorkbenchEnabled: boolean;
  /** The note import's classify, confirm and Profile modals. */
  noteImportView: NoteImportView;
  /** Also runs the note import modal's callbacks, which unload interrupts. */
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit">;
  /** Opens the Attachment `open-attachment` names. */
  opener: Pick<TargetOpener, "open">;
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
 * Handlers auto-deregister when the plugin unloads. Each Obsidian callback
 * runs its handler with the services this Effect runs with, and a handler that
 * fails is logged. Every handler run and every run of a request the Local
 * Server pushes is a fiber of the current Scope: closing it stops the pushed
 * requests and interrupts the runs still going. A legacy Promise a run waits
 * on (Note Feature, a view opener) still runs to its end.
 */
export const registerProtocolHandlers = Effect.fn("registerProtocolHandlers")(
  function* (
    plugin: Pick<Plugin, "registerObsidianProtocolHandler">,
    deps: ProtocolDeps,
  ) {
    const runs = yield* FiberSet.make();
    const run = yield* FiberSet.runtime(runs)<ProtocolServices>();
    const register = (
      id: string,
      handle: (
        data: ObsidianProtocolData,
      ) => Effect.Effect<void, unknown, ProtocolServices>,
    ) =>
      // The callback returns the handler's fiber: Obsidian ignores it, and a
      // test joins it.
      plugin.registerObsidianProtocolHandler(id, (data) =>
        run(
          handle(data).pipe(
            logAndContinue("Protocol handler failed", "protocol", {
              action: id,
            }),
          ),
        ),
      );

    for (const action of protocolActions)
      register(protocolActionId(action), (data) =>
        handleProtocol(action, data, deps),
      );
    register(batchProtocolActionId, (data) => handleBatchProtocol(data, deps));
    register(importProtocolActionId, (data) =>
      handleImportProtocol(data, deps),
    );
    register(importManyProtocolActionId, (data) =>
      handleImportManyProtocol(data, deps),
    );
    register(exploreProtocolActionId, (data) =>
      handleExploreProtocol(data, deps),
    );
    register(openAttachmentProtocolActionId, (data) =>
      handleOpenAttachmentProtocol(data, deps),
    );
    register(updateAllProtocolActionId, (data) =>
      handleUpdateAllProtocol(data, deps),
    );
    register(importAllNotesProtocolActionId, (data) =>
      handleImportAllNotesProtocol(data, deps),
    );
    if (deps.webWorkbenchEnabled)
      register(importProfileProtocolActionId, (data) =>
        handleProfileImportProtocol(data, deps),
      );

    const localServer = yield* LocalServer;
    // A batch update pushed over HTTP (companion couldn't fit the ids in a URL)
    // runs the same interactive flow as the `update-many` protocol link. Each
    // run is a fiber of its own, so a long batch does not hold back the next
    // request.
    const updates = yield* forkEach(localServer.updateManyRequests, (event) =>
      FiberSet.run(runs, updateManyRequested(event, deps)),
    );
    // A batch import pushed over HTTP runs the same flow as the import-notes link.
    const imports = yield* forkEach(localServer.importNotesRequests, (event) =>
      FiberSet.run(runs, importNotesRequested(event, deps)),
    );

    const registration: ProtocolRegistration = {
      idle: Effect.andThen(
        Fiber.awaitAll([updates, imports]),
        FiberSet.awaitEmpty(runs),
      ),
    };
    return registration;
  },
);

/**
 * The edge `zt-main.ts` calls: {@link registerProtocolHandlers} on a Scope of
 * its own, which the returned disposal closes at unload.
 *
 * It calls `runtime.runSync` once, at load, in place of the container's
 * bridge: a departure from policies/services.md → Bridge, which leaves that
 * call to `build.ts`. The registration reads tags, and the bridge runs only
 * Effects that need none. The registration becomes a layer in the plugin
 * graph, and this edge goes away, once ticket 13 converts Note Feature.
 */
export function startProtocolHandlers(
  runtime: Pick<
    ManagedRuntime.ManagedRuntime<ProtocolServices, never>,
    "runSync"
  >,
  plugin: Pick<Plugin, "registerObsidianProtocolHandler">,
  deps: ProtocolDeps,
): AsyncDisposable {
  const { scope, close } = openScope();
  runtime.runSync(
    registerProtocolHandlers(plugin, deps).pipe(Scope.provide(scope)),
  );
  return { [Symbol.asyncDispose]: close };
}

/** The ports a batch import takes, from the handlers' legacy values. */
function importPorts(deps: ProtocolDeps): BatchImportPorts {
  return {
    view: deps.noteImportView,
    noteFeature: deps.noteFeature,
    bridge: deps.bridge,
  };
}

/** The ports a note update takes, from the handlers' legacy values. */
function updatePorts(deps: ProtocolDeps): BatchUpdatePorts {
  return {
    app: deps.app,
    view: deps.noteImportView,
    noteFeature: deps.noteFeature,
    bridge: deps.bridge,
  };
}

/** The outcome notice of a note import, from its toast copy. */
function importNotices<A>(copy: {
  success: (result: A) => NoticeMessage | undefined;
  error: (message: string, error: unknown) => NoticeMessage | undefined;
}): OutcomeCopy<A> {
  return {
    success: copy.success,
    error: (error) => copy.error(toast.formatErrorMessage(error), error),
  };
}

/** The registered handlers, while their Scope holds them. */
export interface ProtocolRegistration {
  /**
   * Completes once both pushed request streams have ended (or the Scope has
   * closed) and no handler run or pushed request run is going.
   */
  readonly idle: Effect.Effect<void>;
}

const updateManyRequested = Effect.fn("protocol.updateManyRequested")(
  function* (event: UpdateManyRequest, deps: ProtocolDeps) {
    const requested = yield* resolveRequestedProfile(event.profileId);
    if (!requested.ok) return;
    yield* reportOutcome(
      runBatchUpdate(updatePorts(deps), event.items, {
        scope: event.scope,
        profile: requested.selector,
      }),
      batchUpdateToast,
    );
  },
  logAndContinue("Pushed batch update failed", "protocol"),
);

const importNotesRequested = Effect.fn("protocol.importNotesRequested")(
  function* (event: ImportNotesRequest, deps: ProtocolDeps) {
    yield* reportOutcome(
      runBatchImport(importPorts(deps), {
        mode: event.mode,
        itemIDs: event.items,
      }),
      importNotices(batchImportToast({ app: deps.app })),
    );
  },
  logAndContinue("Pushed batch import failed", "protocol"),
);

const handleProtocol = Effect.fn("protocol.handleProtocol")(function* (
  action: ProtocolAction,
  data: ObsidianProtocolData,
  deps: ProtocolDeps,
) {
  const query = yield* parseProtocolData(data, {
    action,
    parse: parseProtocolQuery,
  });
  if (!query) return;

  const ref = yield* resolveProtocolItem(query, action);
  if (!ref) return;

  const requested = yield* resolveRequestedProfile(query.profileId);
  if (!requested.ok) return;

  yield* openCompanionNote(deps, ref, {
    action,
    scope: query.scope,
    profile: requested.selector,
    paneType: query.paneType,
  });
});

/**
 * A `profileId` param resolved into a selector. `ok: false` means the text
 * named neither `default` nor a Profile ID — the caller already surfaced the
 * unknown-Profile notice and must stop rather than fall back to the default.
 */
type RequestedProfile =
  | { readonly ok: true; readonly selector: ProfileSelector | undefined }
  | { readonly ok: false };

const resolveRequestedProfile = Effect.fn("protocol.resolveRequestedProfile")(
  function* (text: string | undefined) {
    if (text === undefined) {
      const requested: RequestedProfile = { ok: true, selector: undefined };
      return requested;
    }
    const selector = parseProfileSelector(text);
    if (selector === undefined) {
      yield* notify(
        noteOperationDiagnosticNotice(unknownProfileDiagnostic(text)),
      );
      const refused: RequestedProfile = { ok: false };
      return refused;
    }
    const requested: RequestedProfile = { ok: true, selector };
    return requested;
  },
);

/** Show `message` as a notice. */
const notify = Effect.fn("protocol.notify")(function* (
  message: Parameters<Notifier["Service"]["show"]>[0],
) {
  yield* (yield* Notifier).show(message);
});

/**
 * Handle `obsidian://zotlit/update-many`. Validates the source id at this
 * transport edge, then hands the raw item-id list to {@link runBatchUpdate},
 * which owns the database-ready gate, classification, and the confirm/progress
 * modal.
 */
const handleBatchProtocol = Effect.fn("protocol.handleBatchProtocol")(
  function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
    const action = "update-many";
    const query = yield* parseProtocolData(data, {
      action,
      parse: parseProtocolBatchQuery,
    });
    if (!query) return;

    const requested = yield* resolveRequestedProfile(query.profileId);
    if (!requested.ok) return;

    yield* reportOutcome(
      runBatchUpdate(updatePorts(deps), query.items, {
        scope: query.scope,
        profile: requested.selector,
      }),
      batchUpdateToast,
    );
  },
);

/** A batch update's notices: the early-exit outcomes; a failure shows none. */
const batchUpdateToast = {
  success: batchUpdateNotice,
  error: () => undefined,
};

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
const handleImportProtocol = Effect.fn("protocol.handleImportProtocol")(
  function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
    const action = "import-note";
    const query = yield* parseProtocolData(data, {
      action,
      parse: parseImportProtocolQuery,
    });
    if (!query) return;

    yield* reportOutcome(
      runBatchImport(importPorts(deps), {
        mode: query.mode,
        itemIDs: [query.item],
      }),
      importNotices(batchImportToast({ app: deps.app })),
    );
  },
);

/** Handle `obsidian://zotlit/import-notes`. */
const handleImportManyProtocol = Effect.fn("protocol.handleImportManyProtocol")(
  function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
    const action = "import-notes";
    const query = yield* parseProtocolData(data, {
      action,
      parse: parseImportManyProtocolQuery,
    });
    if (!query) return;

    yield* reportOutcome(
      runBatchImport(importPorts(deps), {
        mode: query.mode,
        itemIDs: query.items,
      }),
      importNotices(batchImportToast({ app: deps.app })),
    );
  },
);

const handleExploreProtocol = Effect.fn("protocol.handleExploreProtocol")(
  function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
    const action = "explore";
    const query = yield* parseProtocolData(data, {
      action,
      parse: parseExploreProtocolQuery,
    });
    if (!query) return;

    const ref = yield* resolveProtocolItem(query, action);
    if (!ref) return;

    yield* Effect.promise(() =>
      openTemplateDataExplorer(
        deps.app,
        {
          itemIndexedKey: ref.indexedKey,
          anchorAnnotationKey: query.annotation,
        },
        { paneType: query.paneType },
      ),
    );
  },
);

/**
 * Handle `obsidian://zotlit/open-attachment`. `query.item` may name either a
 * regular Item or an Attachment directly — `resolveProtocolItem` assumes a
 * regular item, so this branches for itself instead.
 */
const handleOpenAttachmentProtocol = Effect.fn(
  "protocol.handleOpenAttachmentProtocol",
)(function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
  const action = "open-attachment";
  const query = yield* parseProtocolData(data, {
    action,
    parse: parseOpenAttachmentProtocolQuery,
  });
  if (!query) return;

  const zoteroReads = yield* ZoteroReads;
  if (!(yield* databaseReady(zoteroReads, action))) return;

  const attachments = yield* zoteroReads.reads.AttachmentsAt({
    itemID: query.item,
  });

  const openable = toObsidianOpenable(attachments, {
    vaultBasePath: (yield* ObsidianEnv).basePath,
    zoteroPref: yield* (yield* ZoteroPref).current,
  });

  openAttachments(openable, {
    reader: withPaneOverride(pdfPickerReader(deps.opener), query.paneType),
    app: deps.app,
  });
});

/**
 * The Suggest modal's own click decides the pane (Mod-click/Mod-Enter) when
 * the link names none; a named `paneType` wins outright, since the link's own
 * request should not be second-guessed by how the picker was clicked.
 */
function withPaneOverride(
  reader: AttachmentReader<ObsidianOpenableAttachment>,
  paneType: PaneType | undefined,
): AttachmentReader<ObsidianOpenableAttachment> {
  return paneType ? withFixedPane(reader, paneType) : reader;
}

const handleUpdateAllProtocol = Effect.fn("protocol.handleUpdateAllProtocol")(
  function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
    const query = yield* parseProtocolData(data, {
      action: "update-all",
      parse: parseUpdateAllProtocolQuery,
    });
    if (!query) return;

    yield* reportOutcome(
      runBatchUpdateAll(updatePorts(deps), {
        groupID: query.groupID,
        collectionKey: query.collectionKey,
      }),
      { success: updateAllNotice, error: () => undefined },
    );
  },
);

/** Handle `obsidian://zotlit/import-all-notes`. */
const handleImportAllNotesProtocol = Effect.fn(
  "protocol.handleImportAllNotesProtocol",
)(function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
  const query = yield* parseProtocolData(data, {
    action: "import-all-notes",
    parse: parseImportAllNotesProtocolQuery,
  });
  if (!query) return;

  yield* reportOutcome(
    runBatchImportAll(importPorts(deps), {
      groupID: query.groupID,
      collectionKey: query.collectionKey,
    }),
    importNotices(batchImportAllToast({ app: deps.app })),
  );
});

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

/**
 * The link's query, or `null` when it does not parse (after the invalid-link
 * notice) or names another Zotero.
 */
function parseProtocolData<Query extends { sourceId: string }>(
  data: ObsidianProtocolData,
  options: {
    action: string;
    parse: (data: Record<string, unknown>) => Query;
  },
): Effect.Effect<Query | null, never, Notifier | ZoteroPref> {
  const { action, parse } = options;
  return Effect.gen(function* () {
    const parsed = yield* Effect.try(() => parse(data)).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Invalid protocol query").pipe(
          Effect.annotateLogs({ action, error: error.cause }),
          Effect.andThen(notify(m.notice_protocol_invalid())),
          Effect.as(null),
        ),
      ),
    );
    if (!parsed) return null;

    const { sourceId } = yield* (yield* ZoteroPref).current;
    if (!protocolSourceMatches(parsed, sourceId)) {
      yield* Effect.logWarning("Protocol source id mismatch").pipe(
        Effect.annotateLogs({
          action,
          received: parsed.sourceId,
          expected: sourceId,
        }),
      );
      return null;
    }

    return parsed;
  }).pipe(withLogCategory("protocol"));
}

/** Whether the database is ready; when it is not, show the notice and say so. */
const databaseReady = Effect.fn("protocol.databaseReady")(function* (
  zoteroReads: Pick<ZoteroReads["Service"], "current">,
  action: string,
) {
  if ((yield* zoteroReads.current).state === "ready") return true;
  yield* Effect.logWarning("Protocol handler: database not ready").pipe(
    Effect.annotateLogs({ action }),
    withLogCategory("protocol"),
  );
  yield* notify(m.notice_protocol_db_unavailable());
  return false;
});

const resolveProtocolItem = Effect.fn("protocol.resolveProtocolItem")(
  function* (query: { item: number }, action: string) {
    const zoteroReads = yield* ZoteroReads;
    if (!(yield* databaseReady(zoteroReads, action))) return null;

    const ref = yield* readDisplayRef(zoteroReads.reads, query.item);
    if (!ref) {
      yield* Effect.logWarning("Protocol handler: item not found").pipe(
        Effect.annotateLogs({ action, itemID: query.item }),
        withLogCategory("protocol"),
      );
      yield* notify(m.notice_protocol_item_not_found());
      return null;
    }

    const { itemID, libraryID, key, groupID, indexedKey } = ref;
    const item: ItemRef = { itemID, libraryID, key, groupID, indexedKey };
    return item;
  },
);

/** Reuses the importer's clipboard reader and consent before opening the written file. */
const handleProfileImportProtocol = Effect.fn(
  "protocol.handleProfileImportProtocol",
)(function* (data: ObsidianProtocolData, deps: ProtocolDeps) {
  const query = yield* Effect.try(() =>
    parseImportProfileProtocolQuery(data),
  ).pipe(
    Effect.catch((error) =>
      Effect.logDebug("Refused clipboard Profile handoff").pipe(
        Effect.annotateLogs({ error: error.cause }),
        Effect.andThen(notify(m.notice_protocol_invalid())),
        Effect.as(null),
      ),
    ),
  );
  if (!query) return;
  // A failure or a defect is reported; an interrupt (unload) passes through.
  yield* openImportedProfile(deps, query.paneType).pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.interrupt
        : Effect.logError("Failed to open clipboard Profile handoff").pipe(
            Effect.annotateLogs({ error: Cause.squash(cause) }),
            Effect.andThen(notify(m.notice_profile_action_failed())),
          ),
    ),
  );
}, withLogCategory("protocol"));

/** The Profile document the import wrote is not in the vault. */
class ImportedProfileMissing extends Data.TaggedError(
  "ImportedProfileMissing",
)<{ readonly path: string }> {
  override get message() {
    return `Imported Profile document is unavailable: ${this.path}`;
  }
}

/** Import a Profile from the clipboard and open it in the workbench. */
const openImportedProfile = Effect.fn("protocol.openImportedProfile")(
  function* (deps: ProtocolDeps, paneType: PaneType | undefined) {
    yield* Effect.logDebug("Opening clipboard Profile import");
    const profile = yield* Effect.tryPromise(() =>
      deps.importProfile({ source: "clipboard" }),
    );
    if (!profile) {
      yield* Effect.logDebug(
        "Clipboard Profile import ended without a document",
      );
      return;
    }
    const file = yield* (yield* Vault).getFileByPath(profile.path);
    if (!file) return yield* new ImportedProfileMissing({ path: profile.path });
    // The workbench picks its own leaf; a named pane hands it one instead.
    const options = paneType
      ? { leaf: yield* (yield* Workspace).getLeaf(paneType) }
      : {};
    yield* Effect.tryPromise(() =>
      openTemplateWorkbench(deps.app, file, options),
    );
    yield* Effect.logDebug("Opened imported Profile in editor").pipe(
      Effect.annotateLogs({ path: profile.path }),
    );
  },
);
