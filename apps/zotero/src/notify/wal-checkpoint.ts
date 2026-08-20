// Debounced PASSIVE WAL checkpoint after Zotero write activity.

import { logger as appLogger } from "@/lib/logger";
import { prefs } from "@/prefs";

const logger = appLogger.getChild(["notify", "wal-checkpoint"]);

/** Trailing debounce: one checkpoint per quiet period. */
const DEBOUNCE_MS = 1_000;
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

const NOOP: Disposable = { [Symbol.dispose]() {} };

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
export async function registerWalCheckpoint(): Promise<Disposable> {
  let mode: unknown;
  try {
    const rows = await Zotero.DB.queryAsync("PRAGMA journal_mode");
    mode = rows?.[0]?.journal_mode;
  } catch (error) {
    logger.warning("journal mode probe failed, wal checkpoint inactive", {
      error,
    });
    return NOOP;
  }
  if (mode !== "wal") {
    logger.debug("journal mode is not wal, wal checkpoint inactive", {
      journalMode: mode,
    });
    return NOOP;
  }

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
    } catch (error) {
      // Stay armed: the next notifier event schedules another attempt, and the
      // debounce already caps how often that can happen.
      logger.warning("wal checkpoint failed", { error });
    }
  };

  // Trailing timer resets on every event; the max-wait timer is armed on the
  // first event of a burst and never reset. Whichever fires first clears both
  // and runs one checkpoint — no clock reads involved.
  type Timer = ReturnType<typeof setTimeout>;
  let trailingTimer: Timer | undefined;
  let maxWaitTimer: Timer | undefined;

  const cancel = () => {
    if (trailingTimer !== undefined) clearTimeout(trailingTimer);
    if (maxWaitTimer !== undefined) clearTimeout(maxWaitTimer);
    trailingTimer = undefined;
    maxWaitTimer = undefined;
  };

  const fire = () => {
    cancel();
    void checkpoint();
  };

  const observer: { notify: _ZoteroTypes.Notifier.Notify } = {
    notify() {
      if (trailingTimer !== undefined) clearTimeout(trailingTimer);
      trailingTimer = setTimeout(fire, DEBOUNCE_MS);
      const maxWaitArmed = maxWaitTimer === undefined;
      maxWaitTimer ??= setTimeout(fire, MAX_WAIT_MS);
      logger.trace("wal checkpoint debounce timer {action}", {
        action: maxWaitArmed ? "started" : "reset",
        debounceMs: DEBOUNCE_MS,
        maxWaitArmed,
        maxWaitMs: MAX_WAIT_MS,
      });
    },
  };

  const id = Zotero.Notifier.registerObserver(
    observer,
    TRIGGER_TYPES,
    "zotlit-notify-wal-checkpoint",
  );
  logger.debug("registered wal checkpoint notifier", { id });

  return {
    [Symbol.dispose]() {
      Zotero.Notifier.unregisterObserver(id);
      cancel();
      logger.debug("unregistered wal checkpoint notifier");
    },
  };
}
