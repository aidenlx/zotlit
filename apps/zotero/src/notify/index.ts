import { logger as appLogger } from "@/lib/logger";

import { registerActiveReaderNotify } from "./active-reader";
import { registerAnnotSelectNotify } from "./annot-select";
import { registerItemUpdateNotify } from "./item-update";
import { createSender } from "./send";

const logger = appLogger.getChild("notify");

/**
 * Register all event push surfaces (`item/update`, `reader/active`,
 * `reader/annot-select`). Returns a {@link Disposable} that unregisters the
 * underlying Zotero observers and disconnects the reader DOM observers in LIFO
 * order — important for RDP dev reloads where stale registrations would
 * otherwise linger.
 *
 * Observers are always registered; the `notify` master switch is read at emit
 * time (see {@link notifyEnabled}), so toggling it needs no re-registration.
 */
export function registerNotify(): Disposable {
  logger.info("registering notify");
  const stack = new DisposableStack();
  const send = createSender();
  stack.use(registerItemUpdateNotify(send));
  stack.use(registerActiveReaderNotify(send));
  stack.use(registerAnnotSelectNotify(send));
  stack.defer(() => {
    logger.info("notify torn down");
  });
  logger.info("notify registered");
  return stack.move();
}
