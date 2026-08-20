// Debounced PASSIVE WAL checkpoint after Zotero write activity.

import { debounce } from "@std/async";

import { registerApplicationBlur } from "@/lib/application-blur";
import { logger as appLogger } from "@/lib/logger";
import { prefs } from "@/prefs";

const logger = appLogger.getChild(["notify", "wal-checkpoint"]);

/** Must stay below Obsidian's 800 ms immutable-watch debounce. */
const DEBOUNCE_MS = 500;
/**
 * Cap on how long a burst may push the trailing timer forward, so checkpoints
 * keep flowing through a sustained write storm such as a batch import.
 */
const MAX_WAIT_MS = 10_000;

/**
 * Notifier types whose events mean the database was written in a way the
 * Obsidian side reads. `item-tag` and `tag` are independent triggers: Zotero's
 * bulk tag operations bypass the item save path and fire no `item` event.
 */
const TRIGGER_TYPES: _ZoteroTypes.Notifier.Type[] = [
  "item",
  "item-tag",
  "tag",
  "collection",
  "collection-item",
  "trash",
  "group",
];

export type WalCheckpointStatus =
  | {
      active: true;
      automaticEnabled: boolean;
      lastRun: { at: Date; result: "done" | "failed" } | null;
    }
  | {
      active: false;
      reason: "not-wal" | "probe-failed";
      lastRun: null;
    };

export type ManualCheckpointOutcome =
  | "done"
  | "in-use"
  | "failed"
  | "unavailable";

export interface WalCheckpoint extends Disposable {
  status(): WalCheckpointStatus;
  writeNow(): Promise<ManualCheckpointOutcome>;
}

function inactiveHandle(reason: "not-wal" | "probe-failed"): WalCheckpoint {
  return {
    status: () => ({ active: false, reason, lastRun: null }),
    writeNow: () => Promise.resolve("unavailable"),
    [Symbol.dispose]() {},
  };
}

/**
 * Move recent writes out of the WAL sidecar and into `zotero.sqlite` itself.
 *
 * On a WAL database Zotero appends changes to `zotero.sqlite-wal` and may leave
 * them there for a long time, so the main file the Obsidian watcher fingerprints
 * stays stale and ZotLit reads old data. A `PASSIVE` checkpoint copies the
 * committed WAL frames into the main file, which makes that fingerprint move and
 * the next read return current rows.
 *
 * `PASSIVE` never blocks: it copies whatever frames no reader or writer is
 * holding and returns, never invoking SQLite's busy handler. It is the same
 * operation Zotero 10 runs on itself at idle and at shutdown.
 *
 * Activation is probe-gated on `PRAGMA journal_mode`, so this arms on Zotero 10
 * and on an inherited-WAL Zotero 9 alike, and stays inactive on a
 * rollback-journal database.
 *
 * @see https://www.sqlite.org/pragma.html#pragma_wal_checkpoint
 */
export async function registerWalCheckpoint(): Promise<WalCheckpoint> {
  let mode: unknown;
  try {
    const rows = await Zotero.DB.queryAsync("PRAGMA journal_mode");
    mode = rows?.[0]?.journal_mode;
  } catch (error) {
    logger.warning("journal mode probe failed, wal checkpoint inactive", {
      error,
    });
    return inactiveHandle("probe-failed");
  }
  if (mode !== "wal") {
    logger.debug("journal mode is not wal, wal checkpoint inactive", {
      journalMode: mode,
    });
    return inactiveHandle("not-wal");
  }

  let lastRun: { at: Date; result: "done" | "failed" } | null = null;
  const checkpoint = async () => {
    if (prefs.get<boolean>("extensions.zotlit.wal-checkpoint") === false) {
      logger.debug("wal checkpoint skipped, preference is off", {
        pref: "extensions.zotlit.wal-checkpoint",
      });
      return;
    }
    try {
      const rows = await Zotero.DB.queryAsync("PRAGMA wal_checkpoint(PASSIVE)");
      const row = rows?.[0];
      logger.debug("wal checkpoint done", {
        busy: row?.busy,
        log: row?.log,
        checkpointed: row?.checkpointed,
      });
      lastRun = { at: new Date(), result: "done" };
    } catch (error) {
      // Stay armed: the next notifier event schedules another attempt, and the
      // debounce already caps how often that can happen.
      logger.warning("wal checkpoint failed", { error });
      lastRun = { at: new Date(), result: "failed" };
    }
  };

  const writeNow = async (): Promise<ManualCheckpointOutcome> => {
    try {
      const rows = await Zotero.DB.queryAsync(
        "PRAGMA wal_checkpoint(TRUNCATE)",
      );
      const outcome = rows?.[0]?.busy ? "in-use" : "done";
      lastRun = {
        at: new Date(),
        result: outcome === "done" ? "done" : "failed",
      };
      logger.debug("manual wal checkpoint finished", { outcome });
      return outcome;
    } catch (error) {
      lastRun = { at: new Date(), result: "failed" };
      logger.warning("manual wal checkpoint failed", { error });
      return "failed";
    }
  };

  type Timer = ReturnType<typeof setTimeout>;
  let maxWaitTimer: Timer | undefined;

  const clearMaxWait = () => {
    if (maxWaitTimer !== undefined) clearTimeout(maxWaitTimer);
    maxWaitTimer = undefined;
  };

  const checkpointDebounced = debounce(() => {
    clearMaxWait();
    void checkpoint();
  }, DEBOUNCE_MS);

  const cancel = () => {
    checkpointDebounced.clear();
    clearMaxWait();
  };

  const observer: { notify: _ZoteroTypes.Notifier.Notify } = {
    notify() {
      checkpointDebounced();
      const maxWaitArmed = maxWaitTimer === undefined;
      maxWaitTimer ??= setTimeout(
        () => checkpointDebounced.flush(),
        MAX_WAIT_MS,
      );
      logger.trace("wal checkpoint debounce timer {action}", {
        action: maxWaitArmed ? "started" : "reset",
        debounceMs: DEBOUNCE_MS,
        maxWaitArmed,
        maxWaitMs: MAX_WAIT_MS,
      });
    },
  };

  using stack = new DisposableStack();
  stack.defer(() => logger.debug("unregistered wal checkpoint notifier"));
  stack.defer(cancel);
  stack.use(
    registerApplicationBlur(() => {
      const accelerated = checkpointDebounced.pending;
      checkpointDebounced.flush();
      if (accelerated) {
        logger.debug("accelerated wal checkpoint on application blur");
      }
    }),
  );

  const id = Zotero.Notifier.registerObserver(
    observer,
    TRIGGER_TYPES,
    "zotlit-notify-wal-checkpoint",
  );
  stack.defer(() => Zotero.Notifier.unregisterObserver(id));
  logger.debug("registered wal checkpoint notifier", { id });
  const disposable = stack.move();
  return {
    status: () => ({
      active: true,
      automaticEnabled:
        prefs.get<boolean>("extensions.zotlit.wal-checkpoint") !== false,
      lastRun:
        lastRun === null
          ? null
          : { at: new Date(lastRun.at), result: lastRun.result },
    }),
    writeNow,
    [Symbol.dispose]() {
      disposable[Symbol.dispose]();
    },
  };
}
