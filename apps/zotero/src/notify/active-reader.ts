import { logger as appLogger } from "@/lib/logger";

import { type Send } from "./send";
import { currentSelection, notifyEnabled } from "./shared";

const logger = appLogger.getChild(["notify", "active-reader"]);

/**
 * Push the active reader to the Obsidian listener without monkey-patching: the
 * `tab` notifier's `select` event tells us a tab changed, and the active reader
 * is then `getByTabID(Zotero_Tabs.selectedID)`. This mirrors how Zotero itself
 * tracks the focused reader (it toggles `_iframe.docShellIsActive` in the same
 * notifier path).
 */
export function registerActiveReaderNotify(send: Send): Disposable {
  let lastActiveAttachment: number | null = null;
  const flushActive = () => {
    if (!notifyEnabled()) return;
    const tabID = Zotero.getMainWindows()[0]?.Zotero_Tabs.selectedID;
    if (!tabID) return;
    const reader = Zotero.Reader.getByTabID(tabID);
    const attachmentID = reader?.itemID;
    if (typeof attachmentID !== "number") return; // selected tab isn't a reader
    if (attachmentID === lastActiveAttachment) return;
    lastActiveAttachment = attachmentID;
    const attachment = Zotero.Items.get(attachmentID);
    const itemID = attachment?.parentItemID;
    if (typeof itemID !== "number") return; // standalone attachment, no parent
    const selected =
      typeof attachment?.libraryID === "number"
        ? currentSelection(reader, attachment.libraryID)
        : [];
    logger.debug("active reader changed", {
      itemID,
      attachmentID,
      selected: selected.length,
    });
    void send({
      event: "reader/active",
      itemID,
      attachmentID,
      selected,
    });
  };

  const observer: { notify: _ZoteroTypes.Notifier.Notify } = {
    notify(event, type) {
      if (type === "tab" && event === "select") flushActive();
    },
  };
  const notifierID = Zotero.Notifier.registerObserver(
    observer,
    ["tab"],
    "zotlit-notify-active-reader",
  );
  flushActive(); // a reader may already be focused at startup
  logger.debug("registered active-reader notifier", { id: notifierID });

  return {
    [Symbol.dispose]() {
      Zotero.Notifier.unregisterObserver(notifierID);
      logger.debug("unregistered active-reader notifier");
    },
  };
}
