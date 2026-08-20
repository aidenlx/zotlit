// The freshness pipeline: after Zotero write activity settles, checkpoint the
// WAL where one exists, then send the Freshness Signal to the Obsidian side.

import { debounce } from "@std/async";

import { registerApplicationBlur } from "@/lib/application-blur";
import { logger as appLogger } from "@/lib/logger";
import { prefs } from "@/prefs";

import type { Send } from "./send";

const logger = appLogger.getChild(["notify", "freshness"]);

/** Trailing debounce: one pipeline run per quiet period. */
const DEBOUNCE_MS = 500;
/**
 * Cap on how long a burst may push the trailing timer forward, so runs keep
 * flowing through a sustained write storm such as a batch import.
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
  /**
   * Subscribe to {@link status} changes, so a reader repaints instead of
   * polling. Fires after a checkpoint attempt settles. A run the preference
   * skipped moves nothing, and an inactive checkpoint never runs at all, so
   * neither reports.
   *
   * @returns Teardown that unsubscribes.
   */
  onChange(listener: () => void): () => void;
}

/**
 * Register the freshness pipeline over Zotero write activity: a debounced run
 * that moves recent writes out of the WAL sidecar into `zotero.sqlite` itself
 * (the Checkpoint), then tells the Obsidian side the file is as current as
 * this pipeline can make it (the Freshness Signal, `db/updated`).
 *
 * On a WAL database Zotero appends changes to `zotero.sqlite-wal` and may leave
 * them there for a long time, so the main file the Obsidian watcher fingerprints
 * stays stale and ZotLit reads old data. A `PASSIVE` checkpoint copies the
 * committed WAL frames into the main file, which makes that fingerprint move and
 * the next read return current rows. `PASSIVE` never blocks: it copies whatever
 * frames no reader or writer is holding and returns, never invoking SQLite's
 * busy handler. It is the same operation Zotero 10 runs on itself at idle and at
 * shutdown.
 *
 * The checkpoint step is probe-gated on `PRAGMA journal_mode`, so it arms on
 * Zotero 10 and on an inherited-WAL Zotero 9 alike, and stays inactive on a
 * rollback-journal database — where commits land in the main file directly. The
 * signal is not gated: it follows every settled run, because the main file is
 * then as current as this pipeline can make it — also when the preference
 * skipped the checkpoint or the checkpoint failed, where a clone-mode reader
 * still sees the change (fail open).
 *
 * @see https://www.sqlite.org/pragma.html#pragma_wal_checkpoint
 */
export async function registerFreshness(send: Send): Promise<WalCheckpoint> {
  let inactiveReason: "not-wal" | "probe-failed" | undefined;
  try {
    const rows = await Zotero.DB.queryAsync("PRAGMA journal_mode");
    const mode: unknown = rows?.[0]?.journal_mode;
    if (mode !== "wal") {
      inactiveReason = "not-wal";
      logger.debug("journal mode is not wal, checkpoints inactive", {
        journalMode: mode,
      });
    }
  } catch (error) {
    inactiveReason = "probe-failed";
    logger.warning("journal mode probe failed, checkpoints inactive", {
      error,
    });
  }

  let disposed = false;
  let lastRun: { at: Date; result: "done" | "failed" } | null = null;
  const listeners = new Set<() => void>();
  const emitChange = () => {
    for (const listener of listeners) {
      // A repaint is a notification, never part of the checkpoint outcome.
      try {
        listener();
      } catch (error) {
        logger.warning("wal checkpoint status listener failed", { error });
      }
    }
  };

  const signal = () => {
    void send({ event: "db/updated" });
  };

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
    emitChange();
  };

  const writeNow = async (): Promise<ManualCheckpointOutcome> => {
    if (inactiveReason !== undefined) return "unavailable";
    let outcome: ManualCheckpointOutcome;
    try {
      const rows = await Zotero.DB.queryAsync(
        "PRAGMA wal_checkpoint(TRUNCATE)",
      );
      outcome = rows?.[0]?.busy ? "in-use" : "done";
      // A busy database neither wrote nor failed, so the last run stands: a
      // retry that finds the WAL held must not clear an earlier failure.
      if (outcome === "done") lastRun = { at: new Date(), result: "done" };
      logger.debug("manual wal checkpoint finished", { outcome });
    } catch (error) {
      outcome = "failed";
      lastRun = { at: new Date(), result: "failed" };
      logger.warning("manual wal checkpoint failed", { error });
    }
    emitChange();
    // An `in-use` truncation may still have moved frames, so signal for it
    // too; a failed one moved nothing, so a refresh would find nothing new.
    if (outcome !== "failed") signal();
    return outcome;
  };

  const runPipeline = async () => {
    if (inactiveReason === undefined) await checkpoint();
    // A run whose checkpoint was in flight while the pipeline was disposed
    // must not signal from beyond teardown.
    if (disposed) return;
    signal();
  };

  type Timer = ReturnType<typeof setTimeout>;
  let maxWaitTimer: Timer | undefined;

  const clearMaxWait = () => {
    if (maxWaitTimer !== undefined) clearTimeout(maxWaitTimer);
    maxWaitTimer = undefined;
  };

  const pipelineDebounced = debounce(() => {
    clearMaxWait();
    void runPipeline();
  }, DEBOUNCE_MS);

  const cancel = () => {
    pipelineDebounced.clear();
    clearMaxWait();
  };

  const observer: { notify: _ZoteroTypes.Notifier.Notify } = {
    notify() {
      pipelineDebounced();
      const maxWaitArmed = maxWaitTimer === undefined;
      maxWaitTimer ??= setTimeout(() => pipelineDebounced.flush(), MAX_WAIT_MS);
      logger.trace("freshness debounce timer {action}", {
        action: maxWaitArmed ? "started" : "reset",
        debounceMs: DEBOUNCE_MS,
        maxWaitArmed,
        maxWaitMs: MAX_WAIT_MS,
      });
    },
  };

  using stack = new DisposableStack();
  stack.defer(() => logger.debug("unregistered freshness pipeline"));
  stack.defer(cancel);
  stack.use(
    registerApplicationBlur(() => {
      const accelerated = pipelineDebounced.pending;
      pipelineDebounced.flush();
      if (accelerated) {
        logger.debug("accelerated freshness pipeline on application blur");
      }
    }),
  );

  const id = Zotero.Notifier.registerObserver(
    observer,
    TRIGGER_TYPES,
    "zotlit-notify-freshness",
  );
  stack.defer(() => Zotero.Notifier.unregisterObserver(id));
  logger.debug("registered freshness pipeline", { id });
  const disposable = stack.move();
  return {
    status: () =>
      inactiveReason !== undefined
        ? { active: false, reason: inactiveReason, lastRun: null }
        : {
            active: true,
            automaticEnabled:
              prefs.get<boolean>("extensions.zotlit.wal-checkpoint") !== false,
            lastRun:
              lastRun === null
                ? null
                : { at: new Date(lastRun.at), result: lastRun.result },
          },
    writeNow,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    [Symbol.dispose]() {
      disposed = true;
      listeners.clear();
      disposable[Symbol.dispose]();
    },
  };
}
