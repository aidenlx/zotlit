import { requireMessage } from "@/lib/l10n";
import { logger as appLogger } from "@/lib/logger";

import {
  openAttachmentInObsidian,
  openInObsidian,
  readerTopLevelItem,
} from "./obsidian.js";

const logger = appLogger.getChild(["menus", "reader-page"]);

type ViewEvent = _ZoteroTypes.Reader.EventParams<"createViewContextMenu">;

/**
 * The attachment behind a reader tab — `reader.itemID` itself, per
 * {@link readerTopLevelItem}'s doc comment.
 *
 * @returns the attachment, or `null` when the reader has no associated item
 */
function readerAttachment(
  reader: _ZoteroTypes.ReaderInstance,
): Zotero.Item | null {
  if (reader.itemID === undefined) {
    logger.debug("reader has no itemID");
    return null;
  }
  return Zotero.Items.get(reader.itemID);
}

export async function registerReaderPageMenu(
  pluginID: string,
): Promise<Disposable> {
  logger.debug("registering reader-page menu", { pluginID });
  const [label, openPdfLabel] = await Promise.all([
    requireMessage("zotlit-menu-reader-page-open"),
    requireMessage("zotlit-menu-reader-page-open-pdf"),
  ]);
  logger.debug("loaded reader-page labels", { label, openPdfLabel });

  const handler = ({ reader, append }: ViewEvent): void => {
    append({
      label,
      onCommand: () => {
        const item = readerTopLevelItem(reader);
        if (item === null) return;
        openInObsidian("open", item);
      },
    });
    const attachment = readerAttachment(reader);
    if (attachment !== null && attachment.isPDFAttachment()) {
      append({
        label: openPdfLabel,
        onCommand: () => {
          openAttachmentInObsidian(attachment);
        },
      });
    }
  };

  Zotero.Reader.registerEventListener(
    "createViewContextMenu",
    handler,
    pluginID,
  );
  logger.debug("registered reader-page menu");
  return {
    [Symbol.dispose]() {
      logger.debug("unregistering reader-page menu");
      Zotero.Reader.unregisterEventListener("createViewContextMenu", handler);
    },
  };
}
