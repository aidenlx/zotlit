import {
  type BatchUpdateRequest,
  buildBatchProtocolUrl,
  buildImportManyProtocolUrl,
  buildImportProtocolUrl,
  type ImportMode,
  type ImportNotesRequest,
  buildProtocolUrl,
  type ProtocolAction,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
  type UpdateScope,
} from "@zotlit/protocol";

import { formatValue } from "@/lib/l10n";
import { logger as appLogger } from "@/lib/logger";
import { notifyUrl } from "@/notify/shared";
import { sourceId } from "@/notify/source";
import { type FluentMessageId } from "@/types/fluent";

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

  if (url.length <= URL_LENGTH_CAP) {
    logger.info("opening obsidian (batch link)", {
      count: itemIDs.length,
      length: url.length,
      scope,
    });
    Zotero.launchURL(url);
    return;
  }

  logger.info("batch link over cap, putting listener", {
    count: itemIDs.length,
    length: url.length,
    scope,
  });
  await sendBatchUpdate(itemIDs, scope);
}

async function sendBatchUpdate(
  items: number[],
  scope?: UpdateScope,
): Promise<void> {
  const base = notifyUrl();
  if (!base) {
    logger.warn("no notify URL for batch update fallback");
    await showServerHint();
    return;
  }

  const progress = new Zotero.ProgressWindow({
    window: Zotero.getMainWindow(),
  });
  progress.changeHeadline(
    (await formatValue("zotlit-batch-update-sending-title")) ?? "",
  );
  progress.show();

  try {
    const response = await fetch(new URL("/literature-notes", base), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        [SOURCE_ID_HEADER]: sourceId(),
      },
      body: JSON.stringify({ items, scope } satisfies BatchUpdateRequest),
    });
    if (!response.ok) {
      throw new Error(`PUT /literature-notes failed: ${response.status}`);
    }
    logger.info("sent batch update", { base, count: items.length });
    await settleProgress(progress, {
      titleId: "zotlit-batch-update-sent-title",
      messageId: "zotlit-batch-update-sent-message",
      messageArgs: { count: items.length },
    });
  } catch (error) {
    logger.warn("failed to send batch update", { base, error });
    await settleProgress(progress, {
      titleId: "zotlit-batch-update-failed-title",
      messageId: "zotlit-batch-update-failed-message",
    });
  }
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

  if (url.length <= URL_LENGTH_CAP) {
    logger.info("opening obsidian (import link)", {
      count: itemIDs.length,
      length: url.length,
      mode,
    });
    Zotero.launchURL(url);
    return;
  }

  logger.info("import link over cap, putting listener", {
    count: itemIDs.length,
    length: url.length,
    mode,
  });
  await sendBatchImport(itemIDs, mode);
}

async function sendBatchImport(
  items: readonly number[],
  mode: ImportMode,
): Promise<void> {
  const base = notifyUrl();
  if (!base) {
    logger.warn("no notify URL for batch import fallback");
    await showServerHint();
    return;
  }

  const progress = new Zotero.ProgressWindow({
    window: Zotero.getMainWindow(),
  });
  progress.changeHeadline(
    (await formatValue("zotlit-batch-import-sending-title")) ?? "",
  );
  progress.show();

  try {
    const response = await fetch(new URL("/zotero-notes", base), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
        [SOURCE_ID_HEADER]: sourceId(),
      },
      body: JSON.stringify({
        items: [...items],
        mode,
      } satisfies ImportNotesRequest),
    });
    if (!response.ok) {
      throw new Error(`PUT /zotero-notes failed: ${response.status}`);
    }
    logger.info("sent batch import", { base, count: items.length, mode });
    await settleProgress(progress, {
      titleId: "zotlit-batch-import-sent-title",
      messageId: "zotlit-batch-import-sent-message",
      messageArgs: { count: items.length },
    });
  } catch (error) {
    logger.warn("failed to send batch import", { base, error });
    await settleProgress(progress, {
      titleId: "zotlit-batch-update-failed-title",
      messageId: "zotlit-batch-update-failed-message",
    });
  }
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
