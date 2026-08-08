import {
  buildBatchProtocolUrl,
  buildExploreProtocolUrl,
  buildImportAllNotesProtocolUrl,
  buildImportManyProtocolUrl,
  buildImportProtocolUrl,
  buildProtocolUrl,
  buildUpdateAllProtocolUrl,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";
import type {
  BatchUpdateRequest,
  ImportMode,
  ImportNotesRequest,
  ProtocolAction,
  UpdateScope,
} from "@zotlit/protocol";

import { formatValue } from "@/lib/l10n";
import { logger as appLogger } from "@/lib/logger";
import { notifyUrl } from "@/notify/shared";
import { sourceId } from "@/notify/source";
import type { FluentMessageId } from "@/types/fluent";

const logger = appLogger.getChild(["menus", "obsidian"]);

/**
 * Longest `obsidian://` URL we hand to `Zotero.launchURL`. Past this the OS URI
 * handler truncates silently on some platforms, so a larger batch falls back to
 * an HTTP POST to the Obsidian listener.
 */
const URL_LENGTH_CAP = 2000;

/**
 * Open Obsidian for one literature item via its
 * `obsidian://zotlit/<action>?item=<id>&source-id=<hash>` link.
 * `Zotero.launchURL` routes the non-`zotero:`/`http(s):` scheme to the OS
 * default handler.
 */
export function openInObsidian(
  action: ProtocolAction,
  item: Zotero.Item,
  scope?: UpdateScope,
): void {
  const url = buildProtocolUrl(action, item.id, {
    sourceId: sourceId(),
    scope,
  });
  logger.info("opening obsidian", { action, itemID: item.id, scope, url });
  Zotero.launchURL(url);
}

export function exploreInObsidian(
  item: Zotero.Item,
  annotation?: string,
): void {
  const url = buildExploreProtocolUrl(item.id, {
    sourceId: sourceId(),
    annotation,
  });
  logger.info("opening obsidian (explore)", {
    itemID: item.id,
    annotation,
    url,
  });
  Zotero.launchURL(url);
}

/**
 * Ask Obsidian to create or update literature notes for every item in scope.
 * Obsidian checks the `groupID` against its own configured citation library and
 * skips when they differ.
 *
 * @param groupID `0` for the personal library, a positive integer for a group.
 * @param collectionKey narrows the run to that collection and every collection
 *   nested under it; absent covers the whole library.
 */
export function updateAllInObsidian(
  groupID: number,
  collectionKey?: string,
): void {
  const url = buildUpdateAllProtocolUrl(sourceId(), groupID, collectionKey);
  logger.info("opening obsidian (update-all)", { groupID, collectionKey, url });
  Zotero.launchURL(url);
}

/**
 * Ask Obsidian to import every Zotero note in scope — child notes of regular
 * items and standalone notes alike.
 *
 * @param groupID `0` for the personal library, a positive integer for a group.
 * @param collectionKey narrows the run to that collection and every collection
 *   nested under it; absent covers the whole library.
 */
export function importAllNotesInObsidian(
  groupID: number,
  collectionKey?: string,
): void {
  const url = buildImportAllNotesProtocolUrl(
    sourceId(),
    groupID,
    collectionKey,
  );
  logger.info("opening obsidian (import-all-notes)", {
    groupID,
    collectionKey,
    url,
  });
  Zotero.launchURL(url);
}

/** l10n ids driving one {@link launchOrPut} run's progress-window copy. */
interface ListenerMessages {
  sendingTitleId: FluentMessageId;
  sentTitleId: FluentMessageId;
  sentMessageId: FluentMessageId;
  failedTitleId: FluentMessageId;
  failedMessageId: FluentMessageId;
}

/**
 * Opens `url` directly when it fits {@link URL_LENGTH_CAP}; otherwise PUTs
 * `body` to the configured Obsidian listener at `path` and reports the
 * outcome on a {@link Zotero.ProgressWindow}. If no listener is reachable,
 * shows a hint pointing at the server setting.
 */
async function launchOrPut(
  url: string,
  {
    label,
    path,
    body,
    count,
    messages,
  }: {
    /** Noun used in log lines, e.g. `"batch update"` / `"batch import"`. */
    label: string;
    path: string;
    body: unknown;
    count: number;
    messages: ListenerMessages;
  },
): Promise<void> {
  if (url.length <= URL_LENGTH_CAP) {
    logger.info(`opening obsidian (${label} link)`, {
      count,
      length: url.length,
    });
    Zotero.launchURL(url);
    return;
  }

  logger.info(`${label} link over cap, putting listener`, {
    count,
    length: url.length,
  });

  const base = notifyUrl();
  if (!base) {
    logger.warn(`no notify URL for ${label} fallback`);
    await showServerHint();
    return;
  }

  const progress = new Zotero.ProgressWindow({
    window: Zotero.getMainWindow(),
  });
  progress.changeHeadline((await formatValue(messages.sendingTitleId)) ?? "");
  progress.show();

  try {
    const response = await fetch(new URL(path, base), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        [SOURCE_ID_HEADER]: sourceId(),
      },
      body: JSON.stringify(body),
    });
    if (response.status === 426) {
      logger.warn("obsidian rejected protocol version", { base });
      await settleProtocolMismatch(progress);
      return;
    }
    if (!response.ok) {
      throw new Error(`PUT ${path} failed: ${response.status}`);
    }
    logger.info(`sent ${label}`, { base, count });
    await settleProgress(progress, {
      titleId: messages.sentTitleId,
      messageId: messages.sentMessageId,
      messageArgs: { count },
    });
  } catch (error) {
    logger.warn(`failed to send ${label}`, { base, error });
    await settleProgress(progress, {
      titleId: messages.failedTitleId,
      messageId: messages.failedMessageId,
    });
  }
}

/**
 * Batch-update many literature items in one action. Sends a single
 * `update-many` link when it fits in {@link URL_LENGTH_CAP}; otherwise PUTs
 * the id list to the configured Obsidian listener. If no listener is reachable,
 * shows a hint pointing at the server setting.
 */
export async function updateManyInObsidian(
  items: readonly Zotero.Item[],
  scope?: UpdateScope,
): Promise<void> {
  const itemIDs = items.map((item) => item.id);
  const url = buildBatchProtocolUrl(itemIDs, { sourceId: sourceId(), scope });

  await launchOrPut(url, {
    label: "batch update",
    path: "/literature-notes",
    body: { items: itemIDs, scope } satisfies BatchUpdateRequest,
    count: itemIDs.length,
    messages: {
      sendingTitleId: "zotlit-batch-update-sending-title",
      sentTitleId: "zotlit-batch-update-sent-title",
      sentMessageId: "zotlit-batch-update-sent-message",
      failedTitleId: "zotlit-batch-update-failed-title",
      failedMessageId: "zotlit-batch-update-failed-message",
    },
  });
}

/**
 * The background PUT never surfaces the Obsidian window, so the user never
 * sees the import prompt waiting there. Updating the headline and description
 * on the in-flight progress window reports the outcome — "continue in Obsidian"
 * on success, the failure hint otherwise — and auto-dismisses after a moment.
 */
async function settleProgress(
  progress: Zotero.ProgressWindow,
  {
    titleId,
    messageId,
    messageArgs,
  }: {
    titleId: FluentMessageId;
    messageId: FluentMessageId;
    messageArgs?: Record<string, number>;
  },
): Promise<void> {
  const [title, message] = await Promise.all([
    formatValue(titleId),
    formatValue(messageId, messageArgs),
  ]);
  progress.changeHeadline(title ?? "");
  progress.addDescription(message ?? "");
  progress.startCloseTimer(8000);
}

/**
 * The Obsidian listener returns 426 when the request's protocol version is
 * incompatible with the one it expects. This is distinct from an unreachable
 * listener, so it gets its own copy telling the user to update the plugins.
 */
async function settleProtocolMismatch(
  progress: Zotero.ProgressWindow,
): Promise<void> {
  await settleProgress(progress, {
    titleId: "zotlit-protocol-incompatible-title",
    messageId: "zotlit-protocol-incompatible-message",
  });
}

async function showServerHint(): Promise<void> {
  const [title, message] = await Promise.all([
    formatValue("zotlit-batch-update-server-needed-title"),
    formatValue("zotlit-batch-update-server-needed-message"),
  ]);
  Zotero.alert(Zotero.getMainWindow(), title ?? "", message ?? "");
}

/**
 * Import a single note item in Obsidian via its
 * `obsidian://zotlit/import-note?item=<id>&mode=<mode>&source-id=<hash>` link.
 */
export function importInObsidian(itemID: number, mode: ImportMode): void {
  const url = buildImportProtocolUrl(itemID, { sourceId: sourceId(), mode });
  logger.info("opening obsidian (import link)", { itemID, mode, url });
  Zotero.launchURL(url);
}

/**
 * Batch-import note items in Obsidian. Sends a single `import-notes` link when
 * it fits in {@link URL_LENGTH_CAP}; otherwise PUTs the body to the Obsidian
 * listener at `PUT /zotero-notes`.
 */
export async function importManyInObsidian(
  itemIDs: readonly number[],
  mode: ImportMode,
): Promise<void> {
  const url = buildImportManyProtocolUrl(itemIDs, {
    sourceId: sourceId(),
    mode,
  });

  await launchOrPut(url, {
    label: "batch import",
    path: "/zotero-notes",
    body: { items: [...itemIDs], mode } satisfies ImportNotesRequest,
    count: itemIDs.length,
    messages: {
      sendingTitleId: "zotlit-batch-import-sending-title",
      sentTitleId: "zotlit-batch-import-sent-title",
      sentMessageId: "zotlit-batch-import-sent-message",
      failedTitleId: "zotlit-batch-import-failed-title",
      failedMessageId: "zotlit-batch-import-failed-message",
    },
  });
}

/**
 * The top-level (literature) item behind a reader tab. `reader.itemID` points
 * at the attachment being viewed; its `topLevelItem` is the regular item whose
 * note Obsidian acts on.
 *
 * @returns the parent item, or `null` when the reader has no associated item
 */
export function readerTopLevelItem(
  reader: _ZoteroTypes.ReaderInstance,
): Zotero.Item | null {
  if (reader.itemID === undefined) {
    logger.debug("reader has no itemID");
    return null;
  }
  return Zotero.Items.get(reader.itemID).topLevelItem;
}
