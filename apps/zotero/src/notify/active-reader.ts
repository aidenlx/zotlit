import { debounce } from "@std/async/debounce";

import { logger as appLogger } from "@/lib/logger";

import { type Send } from "./send";
import { NOTIFY_DEBOUNCE_MS, notifyEnabled } from "./shared";

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
  const flushActive = debounce(() => {
    if (!notifyEnabled()) return;
    const tabID = Zotero.getMainWindows()[0]?.Zotero_Tabs.selectedID;
    if (!tabID) return;
    const reader = Zotero.Reader.getByTabID(tabID);
    const attachmentID = reader?.itemID;
    if (typeof attachmentID !== "number") return; // selected tab isn't a reader
    if (attachmentID === lastActiveAttachment) return;
    lastActiveAttachment = attachmentID;
    const itemID = Zotero.Items.get(attachmentID)?.parentItemID;
    if (typeof itemID !== "number") return; // standalone attachment, no parent
    logger.debug("active reader changed", { itemID, attachmentID });
    void send({
      event: "reader/active",
      itemID,
      attachmentID,
    });
  }, NOTIFY_DEBOUNCE_MS);

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
      flushActive.clear();
      logger.debug("unregistered active-reader notifier");
    },
  };
}
