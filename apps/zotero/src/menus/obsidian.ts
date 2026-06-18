import { buildProtocolUrl, type ProtocolAction } from "@zotlit/protocol";

import { logger as appLogger } from "@/lib/logger";
import { currentSource } from "@/notify/source";

const logger = appLogger.getChild(["menus", "obsidian"]);

/**
 * Open Obsidian for one literature item via its
 * `obsidian://zotlit/<action>?item=<id>&source-id=<hash>` link.
 * `Zotero.launchURL` routes the non-`zotero:`/`http(s):` scheme to the OS
 * default handler.
 */
export function openInObsidian(
  action: ProtocolAction,
  item: Zotero.Item,
): void {
  const url = buildProtocolUrl(action, item.id, currentSource().sourceId);
  logger.info("opening obsidian", { action, itemID: item.id, url });
  Zotero.launchURL(url);
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
