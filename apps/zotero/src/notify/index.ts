import { logger as appLogger } from "@/lib/logger";

import { registerActiveReaderNotify } from "./active-reader";
import { registerAnnotSelectNotify } from "./annot-select";
import { registerItemUpdateNotify } from "./item-update";
import { createSender } from "./send";
import { registerWalCheckpoint } from "./wal-checkpoint";
import type { WalCheckpoint } from "./wal-checkpoint";

const logger = appLogger.getChild("notify");

/**
 * Register all event push surfaces (`item/update`, `reader/active`,
 * `reader/annot-select`) plus the WAL checkpoint that keeps `zotero.sqlite`
 * current for the Obsidian side. Returns a {@link Disposable} that
 * unregisters the underlying Zotero observers and disconnects the reader DOM
 * observers in LIFO order — important for RDP dev reloads where stale
 * registrations would otherwise linger.
 *
 * Observers are always registered; the `notify` master switch is read at emit
 * time (see {@link notifyEnabled}), so toggling it needs no re-registration.
 */
export interface Notify extends Disposable {
  checkpoint: WalCheckpoint;
}

export async function registerNotify(): Promise<Notify> {
  logger.info("registering notify");
  using stack = new DisposableStack();
  const send = createSender();
  stack.use(registerItemUpdateNotify(send));
  stack.use(registerActiveReaderNotify(send));
  stack.use(registerAnnotSelectNotify(send));
  const checkpoint = stack.use(await registerWalCheckpoint());
  stack.defer(() => {
    logger.info("notify torn down");
  });
  logger.info("notify registered");
  const disposable = stack.move();
  return {
    checkpoint,
    [Symbol.dispose]() {
      disposable[Symbol.dispose]();
    },
  };
}
