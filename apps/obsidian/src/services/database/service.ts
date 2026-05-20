/**
 * `DatabaseService` — owns a read-only connection to Zotero's `zotero.sqlite`
 * and re-opens it on disk changes.
 *
 * **Single refresh lane** — watcher events, settings changes, and manual
 * `refresh()` all funnel through `#scheduleRefresh()`: at most one open is
 * in flight at a time, and any triggers that arrive during it collapse into
 * a single trailing rerun.
 *
 * **Open mode** — `?mode=ro&immutable=1`. The connection ignores `-wal`/`-shm`
 * and assumes the main DB file is unchanging for its lifetime. We get
 * freshness by closing + re-opening on every refresh; see spec §Freshness model.
 *
 * **State** — `loading` until the first open attempt settles; then `ready`
 * iff `#activeClient` is set, else `degraded`. `ready` resolves on both
 * success and failure of the first open so the settings subscription is
 * always committed and recovery is possible.
 */

import { type FSWatcher, type Stats, watch } from "node:fs";
import { stat as fsStat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createClient,
  type DatabaseClient,
  type DatabaseOptions,
} from "@zotlit/db";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";
import { resolveZoteroDataDir } from "@/services/settings/schema";
import type { Settings, SettingsService } from "@/services/settings/service";

const logger = getLogger("database");

const DEBOUNCE_MS = 500;
const DB_FILENAME = "zotero.sqlite";
const DB_OPTIONS: DatabaseOptions = {
  jit: true,
};

export type DatabaseErrorCode = "not-ready" | "degraded";

export class DatabaseError extends Error {
  readonly code: DatabaseErrorCode;
  override readonly cause?: unknown;

  constructor(code: DatabaseErrorCode, options?: { cause?: unknown }) {
    super(code === "not-ready" ? "Database not ready" : "Database degraded");
    this.name = "DatabaseError";
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export interface DbEvents {
  /** A new working client is now active. Re-query if you cache results. */
  changed: () => void;
  /** Service is now degraded (no active client). */
  degraded: (error: DatabaseError) => void;
  /**
   * A refresh attempt failed without changing service state — the previous
   * working client (or already-degraded condition) is retained. Distinct
   * from `degraded`, which fires only on healthy → degraded transitions.
   * UIs may surface the latest attempt error without invalidating cached data.
   */
  "refresh-failed": (error: DatabaseError) => void;
  /**
   * Edge transitions of refresh activity. Fires `true` when the service
   * enters a busy state, `false` when the chain drains. Coalesced refreshes
   * stay `true` between attempts (no flicker on trailing reruns).
   */
  refreshing: (active: boolean) => void;
}

export interface DatabaseServiceOptions {
  settings: SettingsService;
}

export class DatabaseService extends Service<void> {
  readonly #settings;
  readonly #emitter = createNanoEvents<DbEvents>();

  #firstSettled = false;

  #activeClient: DatabaseClient | null = null;
  /** The resolved DB path the *active client* was opened against. */
  #activePath: string | null = null;
  /** `(mtimeMs, size)` captured immediately after the active open. */
  #activeStat: { mtime: number; size: number } | null = null;
  #degradedError: DatabaseError | null = null;

  /** Latest configured resolved DB path, updated synchronously from settings. */
  #lastDbPath = "";
  #lastAutoRefresh = false;

  /**
   * Dual watch: parent directory + file path. macOS
   * FSEvents only surfaces Zotero's in-place WAL auto-checkpoints to a
   * file-level watch; the dir-level watch only fires on VACUUM atomic-rename
   * and the close-time `wal_checkpoint(TRUNCATE)`. Each is a blind spot for
   * the other.
   */
  #watchers: { dir: FSWatcher; file: FSWatcher } | null = null;
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;

  #refreshInFlight: Promise<void> | null = null;
  #refreshPending = false;
  /** Tracks `refreshing` event state separately from `#refreshInFlight` so
   * coalesced trailing reruns don't bounce the event back to `false`. */
  #refreshingActive = false;
  #disposed = false;

  readonly ready: Promise<void>;

  constructor(options: DatabaseServiceOptions) {
    super();
    this.#settings = options.settings;
    this.ready = this.#load();
  }

  get state(): "loading" | "ready" | "degraded" {
    if (!this.#firstSettled) return "loading";
    return this.#activeClient ? "ready" : "degraded";
  }

  /**
   * @throws {@link DatabaseError} with code `"not-ready"` when still loading,
   *   `"degraded"` when no active client is available.
   */
  get client(): DatabaseClient {
    if (!this.#firstSettled) throw new DatabaseError("not-ready");
    if (!this.#activeClient) {
      throw this.#degradedError ?? new DatabaseError("degraded");
    }
    return this.#activeClient;
  }

  /**
   * Compare the on-disk `(mtime, size)` of the active DB file against what we
   * observed at open time.
   * @returns `false` while a hot path switch is in flight.
   * @throws {@link DatabaseError} while not in `"ready"` state.
   */
  async isUpToDate(): Promise<boolean> {
    if (!this.#firstSettled) throw new DatabaseError("not-ready");
    if (!this.#activeClient || !this.#activePath || !this.#activeStat) {
      throw this.#degradedError ?? new DatabaseError("degraded");
    }
    if (this.#activePath !== this.#lastDbPath) return false;
    const stat = await fsStat(this.#activePath);
    return (
      stat.mtimeMs === this.#activeStat.mtime &&
      stat.size === this.#activeStat.size
    );
  }

  /**
   * Drain the refresh lane until quiet. The user sees the *final* state.
   * @throws {@link DatabaseError} with code `"degraded"` if the final state
   *   is degraded.
   */
  async refresh(): Promise<void> {
    // Mark dirty / kick off once at the call site so the drain loop is a pure
    // join and cannot self-dirty.
    if (this.#refreshInFlight) {
      this.#refreshPending = true;
    } else {
      void this.#scheduleRefresh();
    }
    while (this.#refreshInFlight) {
      await this.#refreshInFlight.catch(() => undefined);
    }
    if (this.state === "degraded") {
      throw this.#degradedError ?? new DatabaseError("degraded");
    }
  }

  on<K extends keyof DbEvents>(event: K, cb: DbEvents[K]): () => void {
    return this.#emitter.on(event, cb);
  }

  once<K extends keyof DbEvents>(event: K, cb: DbEvents[K]): () => void {
    return this.#emitter.once(event, cb);
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    // LIFO: unsubscribe (registered last) runs first; teardown runs after.
    stack.defer(async () => {
      await this.#tearDownActive();
    });

    const snapshot = await this.#settings.loaded;
    const dbPath = resolveDbPath(snapshot);
    const autoRefresh = snapshot["zotero.auto-refresh"];
    // Cache configured snapshot regardless of open outcome — required for the
    // synchronous initial subscriber fire to no-op (§5).
    this.#lastDbPath = dbPath;
    this.#lastAutoRefresh = autoRefresh;

    // Tracked separately so a post-open stat failure releases the new client
    // instead of leaking it into degraded state.
    let pendingClient: DatabaseClient | null = null;
    try {
      pendingClient = createClient(buildSqliteUri(dbPath), DB_OPTIONS);
      const stat = await fsStat(dbPath);
      this.#activeClient = pendingClient;
      pendingClient = null;
      this.#activePath = dbPath;
      this.#activeStat = { mtime: stat.mtimeMs, size: stat.size };
      if (autoRefresh) this.#startWatcher(dbPath);
      logger.debug("Initial database open succeeded", {
        dbPath,
        mtime: stat.mtimeMs,
        size: stat.size,
        autoRefresh,
      });
    } catch (error) {
      if (pendingClient) closeClient(pendingClient);
      this.#degradedError = new DatabaseError("degraded", { cause: error });
      logger.warn("Initial database open failed", { error, dbPath });
    }

    stack.defer(
      this.#settings.subscribe((value) => {
        if (value === null) return;
        this.#onSettingsChanged(value);
      }),
    );

    this.#firstSettled = true;
    this.commit(stack.move());
  }

  #onSettingsChanged(s: Readonly<Settings>): void {
    const dbPath = resolveDbPath(s);
    const autoRefresh = s["zotero.auto-refresh"];

    const dbPathChanged = dbPath !== this.#lastDbPath;
    const autoRefreshChanged = autoRefresh !== this.#lastAutoRefresh;
    if (!dbPathChanged && !autoRefreshChanged) return;

    this.#lastDbPath = dbPath;
    this.#lastAutoRefresh = autoRefresh;

    if (dbPathChanged) {
      // #runRefresh re-reads the path and (on success) rebinds the watcher
      // atomically with the new client — consulting #lastAutoRefresh at that
      // point. Do NOT touch the watcher here even if auto-refresh also
      // changed; we'd briefly bind it to the new dir while the active client
      // is still on the old dir.
      logger.debug("DB path changed; scheduling refresh", { dbPath });
      void this.#scheduleRefresh();
    } else if (autoRefreshChanged) {
      logger.debug("Auto-refresh toggled", { autoRefresh });
      this.#applyAutoRefresh(autoRefresh);
    }
  }

  #applyAutoRefresh(enabled: boolean): void {
    if (enabled) {
      if (this.#activeClient && !this.#watchers && this.#activePath) {
        this.#startWatcher(this.#activePath);
      }
    } else {
      this.#stopWatcher();
    }
  }

  #scheduleRefresh(): Promise<void> {
    // After disposal the service must not start new work; #tearDownActive
    // relies on this so the trailing-rerun chain terminates while it drains.
    if (this.#disposed) return Promise.resolve();
    if (this.#refreshInFlight) {
      this.#refreshPending = true;
      return this.#refreshInFlight;
    }
    if (!this.#refreshingActive) {
      this.#refreshingActive = true;
      this.#emitter.emit("refreshing", true);
    }
    this.#refreshInFlight = this.#runRefresh().finally(() => {
      this.#refreshInFlight = null;
      if (this.#refreshPending && !this.#disposed) {
        this.#refreshPending = false;
        void this.#scheduleRefresh();
      } else {
        this.#refreshPending = false;
        this.#refreshingActive = false;
        this.#emitter.emit("refreshing", false);
      }
    });
    return this.#refreshInFlight;
  }

  async #runRefresh(): Promise<void> {
    const dbPath = this.#lastDbPath;
    const prevClient = this.#activeClient;

    let nextClient: DatabaseClient | null = null;
    let stat: Stats;
    try {
      nextClient = createClient(buildSqliteUri(dbPath), DB_OPTIONS);
      stat = await fsStat(dbPath);
    } catch (error) {
      // Close the freshly-opened client if stat (not createClient) failed,
      // so a transient stat error doesn't leak the new SQLite handle.
      if (nextClient) closeClient(nextClient);
      this.#handleRefreshFailure(dbPath, error);
      return;
    }

    const prevPath = this.#activePath;

    // Open-then-close: commit the new client before releasing the old.
    this.#activeClient = nextClient;
    this.#activePath = dbPath;
    this.#activeStat = { mtime: stat.mtimeMs, size: stat.size };
    this.#degradedError = null;

    if (prevClient && prevClient !== nextClient) {
      closeClient(prevClient);
    }

    // Watcher self-heal: every successful open rebinds against the current dir.
    this.#stopWatcher();
    if (this.#lastAutoRefresh) this.#startWatcher(dbPath);

    logger.debug("Refresh succeeded", {
      dbPath,
      mtime: stat.mtimeMs,
      size: stat.size,
      hotSwitch: prevPath !== null && prevPath !== dbPath,
      recoveredFromDegraded: prevClient === null,
    });

    this.#emitter.emit("changed");
  }

  /**
   * Reads `#activeClient`/`#activePath` directly — the failure path in
   * `#runRefresh` runs before those fields are touched.
   */
  #handleRefreshFailure(dbPath: string, error: unknown): void {
    const prevClient = this.#activeClient;
    const prevPath = this.#activePath;
    const hotSwitch =
      prevClient !== null && prevPath !== null && prevPath !== dbPath;

    if (hotSwitch) {
      logger.warn("Hot switch failed; degrading", { error, dbPath, prevPath });
      closeClient(prevClient);
      this.#activeClient = null;
      this.#activePath = null;
      this.#activeStat = null;
      this.#stopWatcher();
      const dbError = new DatabaseError("degraded", { cause: error });
      this.#degradedError = dbError;
      this.#emitter.emit("degraded", dbError);
      return;
    }

    if (prevClient) {
      // Same-path failure: keep the previous client; state unchanged.
      logger.warn("Refresh failed; keeping previous client", { error, dbPath });
      this.#emitter.emit(
        "refresh-failed",
        new DatabaseError("degraded", { cause: error }),
      );
      return;
    }

    // Already degraded → stay degraded; refresh attempt itself failed.
    logger.warn("Refresh failed while degraded", { error, dbPath });
    const dbError = new DatabaseError("degraded", { cause: error });
    this.#degradedError = dbError;
    this.#emitter.emit("refresh-failed", dbError);
  }

  #startWatcher(dbPath: string): void {
    const dir = dirname(dbPath);
    // `persistent: false` so neither watcher keeps Node's event loop alive on
    // its own — Obsidian (Electron) owns the loop, and a leaked watcher must
    // not block process exit if plugin disposal fails.
    let dirWatcher: FSWatcher;
    try {
      dirWatcher = watch(
        dir,
        { persistent: false, recursive: false },
        (event, filename) => {
          if (filename != null && filename !== DB_FILENAME) return;
          logger.debug("Dir watcher event for DB file", { event, filename });
          this.#debouncedRefresh();
        },
      );
    } catch (error) {
      logger.warn("Failed to start dir watcher", { error, dir });
      return;
    }
    let fileWatcher: FSWatcher;
    try {
      fileWatcher = watch(dbPath, { persistent: false }, (event, filename) => {
        logger.debug("File watcher event for DB file", { event, filename });
        this.#debouncedRefresh();
      });
    } catch (error) {
      logger.warn("Failed to start file watcher", { error, dbPath });
      try {
        dirWatcher.close();
      } catch (closeError) {
        logger.warn("Failed to roll back dir watcher", { error: closeError });
      }
      return;
    }
    const onError = (source: "dir" | "file") => (error: Error) => {
      logger.warn("Database {source} watcher error", { source, error });
      this.#stopWatcher();
      void this.#scheduleRefresh();
    };
    dirWatcher.on("error", onError("dir"));
    fileWatcher.on("error", onError("file"));
    this.#watchers = { dir: dirWatcher, file: fileWatcher };
    logger.debug("Watchers started", { dir, dbPath });
  }

  #stopWatcher(): void {
    if (this.#debounceTimer !== null) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    const watchers = this.#watchers;
    if (!watchers) return;
    this.#watchers = null;
    for (const source of ["dir", "file"] as const) {
      try {
        watchers[source].close();
      } catch (error) {
        logger.warn("Database {source} watcher close failed", {
          source,
          error,
        });
      }
    }
    logger.debug("Watchers stopped");
  }

  #debouncedRefresh(): void {
    if (this.#debounceTimer !== null) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      logger.debug("Debounce fired; scheduling refresh");
      void this.#scheduleRefresh();
    }, DEBOUNCE_MS);
  }

  async #tearDownActive(): Promise<void> {
    logger.debug("Disposing database service");
    // Block any further #scheduleRefresh chains (incl. the trailing-rerun
    // that the in-flight refresh's `finally` would otherwise queue).
    this.#disposed = true;
    this.#stopWatcher();

    // Drain the refresh lane. With #disposed set, the finally chain stops
    // queueing trailing reruns, so this loop terminates.
    while (this.#refreshInFlight) {
      await this.#refreshInFlight.catch(() => undefined);
    }

    // The drained refresh may have started a watcher / installed a new
    // client just before we set #disposed. Tear those down now.
    this.#stopWatcher();
    const client = this.#activeClient;
    this.#activeClient = null;
    this.#activePath = null;
    this.#activeStat = null;
    if (client) closeClient(client);
    logger.debug("Database service disposed");
  }
}

function buildSqliteUri(dbPath: string): string {
  const url = pathToFileURL(dbPath);
  url.searchParams.set("mode", "ro");
  url.searchParams.set("immutable", "1");
  return url.toString();
}

function resolveDbPath(s: Readonly<Settings>): string {
  return join(resolveZoteroDataDir(s["zotero.data-dir"]), DB_FILENAME);
}

function closeClient(client: DatabaseClient): void {
  try {
    client.$client.close();
  } catch (error) {
    logger.warn("Failed to close database client", { error });
  }
}
