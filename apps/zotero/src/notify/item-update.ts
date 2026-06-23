import { type ItemUpdate } from "@zotlit/protocol";

import { logger as appLogger } from "@/lib/logger";

import { type Send } from "./send";
import { notifyEnabled } from "./shared";

const logger = appLogger.getChild(["notify", "item"]);

type UpdateKind = "add" | "modify" | "trash";

/**
 * Zotero `item` notifier events map 1:1 to {@link ItemUpdate} buckets.
 * Permanent `delete` is intentionally absent — the item is already gone, so
 * `Zotero.Items.get` can't resolve its library and there's nothing to refresh.
 */
const EVENT_TO_KIND: Partial<Record<_ZoteroTypes.Notifier.Event, UpdateKind>> =
  {
    add: "add",
    modify: "modify",
    trash: "trash",
  };

/**
 * Push regular-item add / modify / trash to the Obsidian listener. Each notifier
 * batch flushes one {@link ItemUpdate}; each bucket is a `Map<itemID, libraryID>`
 * so repeated ids within a batch collapse to one entry.
 */
export function registerItemUpdateNotify(send: Send): Disposable {
  const queue: Record<UpdateKind, Map<number, number>> = {
    add: new Map(),
    modify: new Map(),
    trash: new Map(),
  };

  const flush = () => {
    const toRefs = (bucket: Map<number, number>) =>
      [...bucket].map(([itemID, libraryID]) => ({ itemID, libraryID }));
    const event: Omit<ItemUpdate, "profilePath" | "dataPath"> = {
      event: "item/update",
      add: toRefs(queue.add),
      modify: toRefs(queue.modify),
      trash: toRefs(queue.trash),
    };
    queue.add.clear();
    queue.modify.clear();
    queue.trash.clear();
    if (!event.add.length && !event.modify.length && !event.trash.length) {
      return;
    }
    logger.debug("flushing item update", {
      add: event.add.length,
      modify: event.modify.length,
      trash: event.trash.length,
    });
    void send(event);
  };

  const observer: { notify: _ZoteroTypes.Notifier.Notify } = {
    notify(event, type, ids) {
      if (type !== "item" || !notifyEnabled()) return;
      const kind = EVENT_TO_KIND[event];
      if (!kind) return;
      for (const id of ids) {
        const itemID = typeof id === "number" ? id : Number(id);
        const item = Zotero.Items.get(itemID);
        if (!item?.isRegularItem()) continue;
        queue[kind].set(itemID, item.libraryID);
      }
      flush();
    },
  };

  const id = Zotero.Notifier.registerObserver(
    observer,
    ["item"],
    "zotlit-notify-item",
  );
  logger.debug("registered item notifier", { id });

  return {
    [Symbol.dispose]() {
      Zotero.Notifier.unregisterObserver(id);
      logger.debug("unregistered item notifier");
    },
  };
}
