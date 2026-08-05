import { existsSync, watch, type FSWatcher, type WatchOptions } from "node:fs";
import { dirname, join } from "node:path";

import {
  createClient,
  type DatabaseOptions,
  type NodeDatabaseClient,
} from "@zotlit/db/client/node";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { ZOTERO_DB_FILENAME, ZOTERO_WAL_FILENAME } from "@/lib/constants";
import { DisposableAbortController } from "@/lib/disposables";
import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";
import {
  type Settings,
  type SettingsService,
} from "@/services/settings/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

import {
  buildSqliteUri,
  type ConfiguredReadMode,
  type EffectiveReadMode,
  type PreparedRead,
  prepareRead,
  type ReadFallbackNotice,
  reapStaleReadTemps,
} from "./read-source";

const logger = getLogger("database");
const DB_OPTIONS: DatabaseOptions = {
  jit: true,
};
const WATCH_DEBOUNCE_MS = 2000;
// `persistent: false` so no watcher keeps Node's event loop alive on its own —
// Obsidian (Electron) owns the loop, and a leaked watcher must not block
// process exit if plugin disposal fails.
const WATCH_OPTIONS: WatchOptions = { persistent: false };

export class DatabaseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "DatabaseError";
  }
}

export interface DatabaseEvents {
  /** A new working client is active. Re-query if you cache results. */
  changed: () => void;
  degraded: (error: DatabaseError) => void;
  /**
   * A refresh attempt failed. The service is only `degraded` when there is no
   * previous working client to keep serving.
   */
  "refresh-failed": (error: DatabaseError) => void;
  /**
   * Refresh activity edge transitions. Coalesced trailing reruns stay active
   * until the shared refresh lane drains, so UI busy state does not flicker.
   */
  refreshing: (active: boolean) => void;
  /**
   * The resolved Zotero database file is absent — a fresh device where
   * auto-detect missed the install. Raised at most once per launch (see the
   * gate in {@link DatabaseService}). A UI subscriber renders the notice.
   */
  "db-file-missing": () => void;
  /**
   * The configured read mode fell back to another mode. Raised at most once
   * per fallback kind per launch. A UI subscriber renders the notice.
   */
  "read-fallback": (notice: ReadFallbackNotice) => void;
}

export interface DatabaseServiceDeps {
  settings: SettingsService;
  zoteroPref: ZoteroPrefService;
}

/**
 * A pinned read handle from {@link DatabaseService.acquireRead}. Keeps the
 * current client alive and defers refresh swaps until disposed. `client` is
 * captured at acquire time and stays stable for the lease's whole life, so a
 * long-running read (e.g. a batch) sees one snapshot instead of a torn one.
 */
interface DatabaseReadLease extends Disposable {
  readonly client: NodeDatabaseClient;
}

export class DatabaseService extends Service<void> {
  readonly #settings;
  readonly #zoteroPref;
  readonly #emitter = createNanoEvents<DatabaseEvents>();

  #state: "loading" | "ready" | "degraded" = "loading";
  #error: DatabaseError | null = null;
  #client: NodeDatabaseClient | null = null;
  #sourcePath: string | null = null;
  #readMode: EffectiveReadMode | null = null;
  #activeReadStack: AsyncDisposableStack | null = null;
  #watchers: FSWatcher[] = [];
  #walWatcher: FSWatcher | null = null;
  #watchTimer: number | null = null;
  #refreshInFlight: Promise<void> | null = null;
  #refreshAgain = false;
  #leaseCount = 0;
  #deferredRefresh: PromiseWithResolvers<void> | null = null;
  #torndown = false;
  #lastSourcePath: string | null = null;
  #lastConfiguredMode: ConfiguredReadMode | null = null;
  #lastAutoRefresh: boolean | null = null;
  readonly #shownFallbackNotices = new Set<string>();
  /** Gate so the fresh-device signal raises at most once per launch. */
  #missingDbSignalled = false;

  /**
   * Startup-only: awaits upstream deps, runs the first open attempt, and commits
   * subscriptions/teardown. Always settles (the first open swallows its own
   * failure into `degraded` state) so a failed start still leaves the service
   * recoverable via {@link refresh}.
   */
  ready: Promise<void>;

  constructor(deps: DatabaseServiceDeps) {
    super();
    this.#settings = deps.settings;
    this.#zoteroPref = deps.zoteroPref;
    this.ready = this.#load();
  }

  get state(): "loading" | "ready" | "degraded" {
    return this.#state;
  }

  get activeReadMode(): EffectiveReadMode | null {
    return this.#readMode;
  }

  get error(): DatabaseError | null {
    return this.#error;
  }

  get client(): NodeDatabaseClient {
    if (!this.#client) {
      throw new DatabaseError("degraded", this.#error);
    }
    return this.#client;
  }

  on<K extends keyof DatabaseEvents>(
    event: K,
    cb: DatabaseEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  async refresh(): Promise<void> {
    await this.ready;
    await this.#enqueueRefresh();
    if (this.#state === "degraded") {
      throw new DatabaseError("degraded", this.#error);
    }
  }

  /**
   * Pin the current client and defer refresh swaps for the returned lease's
   * lifetime. Use for reads that span a long async lifetime (e.g. a batch run)
   * and would otherwise observe a mid-flight client swap as a closed-connection
   * throw or a torn snapshot. Dispose the lease (via `using`) to let any
   * deferred refresh run.
   *
   * @throws {@link DatabaseError} when the service is degraded.
   */
  async acquireRead(): Promise<DatabaseReadLease> {
    await this.ready;
    // Increment first (synchronous) so the refresh gate sees the lease before
    // any future trigger can start a swap.
    this.#leaseCount += 1;
    try {
      // A refresh that started before this increment is not gated; await it so
      // the lease pins the post-swap client rather than a client about to close.
      if (this.#refreshInFlight) await this.#refreshInFlight;
      if (this.#state === "degraded" || !this.#client) {
        throw new DatabaseError("degraded", this.#error);
      }
      return this.#createLease(this.#client);
    } catch (error) {
      this.#releaseLease();
      throw error;
    }
  }

  #createLease(client: NodeDatabaseClient): DatabaseReadLease {
    let released = false;
    return {
      client,
      [Symbol.dispose]: () => {
        if (released) return;
        released = true;
        this.#releaseLease();
      },
    };
  }

  /**
   * Synchronous lease release: the decrement → check-zero → start-refresh
   * sequence must not yield, or a lease re-acquired in the gap would strand the
   * deferred refresh. No-op once torn down — teardown ignores leases.
   */
  #releaseLease(): void {
    this.#leaseCount -= 1;
    if (this.#torndown || this.#leaseCount > 0 || !this.#deferredRefresh)
      return;
    const deferred = this.#deferredRefresh;
    this.#deferredRefresh = null;
    void this.#enqueueRefresh().finally(() => deferred.resolve());
  }

  /**
   * External "the database changed" signal (e.g. a Zotero push notification).
   * Feeds the same debounced, single-flight refresh lane as the filesystem
   * watchers, so a push and an fs.watch tick for the same write coalesce into
   * one refresh. Independent of `zotero.auto-refresh` — that flag only governs
   * fs.watch binding; a push is its own change source and always refreshes.
   */
  notifyExternalChange(): void {
    logger.debug("External change signalled, scheduling watched refresh");
    this.#scheduleWatchedRefresh();
  }

  async #load(): Promise<void> {
    await this.#zoteroPref.ready;
    const settings = await this.#settings.loaded;

    await using stack = new AsyncDisposableStack();
    const reapAbort = stack.use(new DisposableAbortController());
    void reapStaleReadTemps(reapAbort.signal).catch((error) => {
      if (reapAbort.signal.aborted) return;
      logger.warn("Failed to reap stale database read temps", { error });
    });
    stack.defer(() => this.#disposeWatchers());
    stack.defer(async () => {
      await this.#activeReadStack?.disposeAsync();
      this.#activeReadStack = null;
      this.#client = null;
    });

    this.#lastSourcePath = this.#zoteroPref.databasePath;
    this.#lastConfiguredMode = settings["zotero.read-mode"];
    this.#lastAutoRefresh = settings["zotero.auto-refresh"];
    logger.debug("Database service initializing", {
      sourcePath: this.#lastSourcePath,
      configuredMode: this.#lastConfiguredMode,
      autoRefresh: this.#lastAutoRefresh,
    });

    stack.defer(
      this.#settings.subscribe((value) => {
        if (value) this.#onSettingsChanged(value);
      }),
    );
    const onSourcePathMaybeChanged = (): void => {
      const next = this.#zoteroPref.databasePath;
      if (next === this.#lastSourcePath) return;
      logger.debug("Zotero database path changed", {
        prev: this.#lastSourcePath,
        next,
      });
      this.#lastSourcePath = next;
      this.#scheduleRefresh();
    };
    // `resolved-changed` fires for either cause that can move the resolved
    // database path — a profile re-read or a data-dir override; the handler
    // still diffs `databasePath` to skip no-op re-reads.
    stack.defer(
      this.#zoteroPref.on("resolved-changed", onSourcePathMaybeChanged),
    );
    // Registered last so it runs first on disposal (stack is LIFO): the flag
    // must flip before any client/watcher teardown, so a lease releasing during
    // the async disposal window no-ops instead of scheduling a refresh against a
    // half-disposed service. Teardown is unconditional and ignores leases; a
    // still-deferred refresh() simply never resolves (its toast unloads with us).
    stack.defer(() => {
      this.#torndown = true;
    });

    await this.#refreshOnce();
    this.commit(stack.move());
  }

  #onSettingsChanged(settings: Readonly<Settings>): void {
    const readMode = settings["zotero.read-mode"];
    const autoRefresh = settings["zotero.auto-refresh"];
    if (autoRefresh !== this.#lastAutoRefresh) {
      logger.debug("Auto-refresh setting changed", {
        prev: this.#lastAutoRefresh,
        next: autoRefresh,
      });
      this.#lastAutoRefresh = autoRefresh;
      void this.#rebindWatchers();
    }
    if (readMode === this.#lastConfiguredMode) return;
    logger.debug("Read mode setting changed", {
      prev: this.#lastConfiguredMode,
      next: readMode,
    });
    this.#lastConfiguredMode = readMode;
    this.#scheduleRefresh();
  }

  #scheduleRefresh(): void {
    void this.#enqueueRefresh().catch((error) => {
      logger.error("Scheduled database refresh failed", { error });
    });
  }

  /**
   * Single-flight refresh lane with trailing-rerun coalescing: every trigger
   * (manual refresh, settings/path change, watcher event) shares one in-flight
   * run. Triggers arriving mid-run set a single trailing rerun rather than
   * queueing, so a burst of watcher events collapses into one extra refresh.
   */
  #enqueueRefresh(): Promise<void> {
    // Gate before the coalesce branch: while a read lease is held, a trigger
    // must not start a swap or set a trailing rerun. It only records that a
    // refresh is owed; the last lease release runs it. One shared promise lets
    // a user-initiated refresh() defer-and-wait for that post-drain run, while
    // passive triggers simply leave the boolean set and ignore the result.
    if (this.#leaseCount > 0) {
      logger.debug("Refresh deferred while read lease held");
      this.#deferredRefresh ??= Promise.withResolvers<void>();
      return this.#deferredRefresh.promise;
    }
    if (this.#refreshInFlight) {
      logger.debug("Refresh in flight, coalescing trailing rerun");
      this.#refreshAgain = true;
      return this.#refreshInFlight;
    }
    logger.debug("Enqueueing database refresh");
    this.#refreshInFlight = this.#refreshLoop().finally(() => {
      this.#refreshInFlight = null;
    });
    return this.#refreshInFlight;
  }

  async #refreshLoop(): Promise<void> {
    this.#emitter.emit("refreshing", true);
    logger.debug("Refresh loop started");
    try {
      do {
        this.#refreshAgain = false;
        await this.#refreshOnce();
        if (this.#refreshAgain)
          logger.debug("Trailing request queued, rerunning refresh");
      } while (this.#refreshAgain);
    } finally {
      this.#emitter.emit("refreshing", false);
      logger.debug("Refresh loop complete");
    }
  }

  async #refreshOnce(): Promise<void> {
    try {
      await using refreshStack = new AsyncDisposableStack();
      const settings = this.#settings.current ?? (await this.#settings.loaded);
      const sourcePath = this.#zoteroPref.databasePath;
      const configuredMode = settings["zotero.read-mode"];
      const prepared = refreshStack.use(
        await prepareRead(configuredMode, sourcePath),
      );
      const uri = buildSqliteUri(prepared.path, prepared.uriOptions);
      const client = createClient(uri, DB_OPTIONS);
      refreshStack.use(client.$client);
      this.#signalReadFallback(prepared);

      const previousReadStack = this.#activeReadStack;
      // Commit the new client before releasing the old read stack.
      this.#client = client;
      this.#activeReadStack = refreshStack.move();
      this.#sourcePath = sourcePath;
      this.#readMode = prepared.effectiveMode;
      this.#state = "ready";
      this.#error = null;

      await previousReadStack?.disposeAsync();
      await this.#rebindWatchers();
      this.#emitter.emit("changed");
      logger.info("Opened Zotero database", {
        sourcePath,
        readMode: this.#readMode,
      });
    } catch (cause) {
      const error = new DatabaseError("refresh-failed", cause);
      this.#emitter.emit("refresh-failed", error);
      logger.warn("Failed to refresh Zotero database", { error });
      this.#maybeSignalMissingDatabase();

      // Keep serving the previous client on a failed refresh; only go degraded
      // (and tear down watchers) when there was never a working client to fall
      // back to. Fallback notices are kept separate from refresh-failure events.
      if (this.#client) {
        this.#error = error;
      } else {
        this.#state = "degraded";
        this.#disposeWatchers();
        const degraded = new DatabaseError("degraded", error);
        this.#error = degraded;
        this.#emitter.emit("degraded", degraded);
      }
    }
  }

  /**
   * Fresh-device handling: when a refresh fails because the resolved database
   * file is absent (a synced vault landing on a machine with a custom Zotero
   * location where auto-detect misses), emits `db-file-missing`; a
   * Welcome-View subscriber renders the durable notice. Other failure causes
   * (locks, corruption — the file exists) are left to the normal
   * degraded/failed path. At most once per launch; recurs on later launches
   * while the file stays missing since no dismissal state is stored.
   */
  #maybeSignalMissingDatabase(): void {
    if (this.#missingDbSignalled) return;
    const dbPath = this.#zoteroPref.databasePath;
    if (existsSync(dbPath)) return;
    this.#missingDbSignalled = true;
    logger.info("Zotero database not found on this device", { dbPath });
    this.#emitter.emit("db-file-missing");
  }

  #signalReadFallback(prepared: PreparedRead): void {
    if (!prepared.fallbackNotice) return;
    if (this.#shownFallbackNotices.has(prepared.fallbackNotice)) return;
    this.#shownFallbackNotices.add(prepared.fallbackNotice);
    logger.warn("Database read mode fell back", {
      fallbackNotice: prepared.fallbackNotice,
      effectiveMode: prepared.effectiveMode,
    });
    this.#emitter.emit("read-fallback", prepared.fallbackNotice);
  }

  /**
   * Rebinds after a successful swap so watchers always track the now-active
   * source path and effective mode. Auto-refresh off means no watchers at all.
   * macOS FSEvents reports WAL checkpoints and VACUUM replacement through
   * different watch targets, so the parent directory, DB file, and live WAL file
   * each cover blind spots in the others.
   */
  async #rebindWatchers(): Promise<void> {
    this.#disposeWatchers();
    const settings = this.#settings.current;
    if (!settings?.["zotero.auto-refresh"]) {
      logger.debug("Auto-refresh disabled, skipping watcher bind");
      return;
    }
    if (!this.#sourcePath || !this.#readMode) return;

    const parent = dirname(this.#sourcePath);
    logger.debug("Binding database watchers", {
      sourcePath: this.#sourcePath,
      readMode: this.#readMode,
      parent,
    });
    this.#watchers.push(
      watch(parent, WATCH_OPTIONS, (event, filename) => {
        const name = filename?.toString();
        const relevant = this.#watchedFilename(name);
        logger.trace("Directory watcher event", {
          event,
          filename: name,
          relevant,
        });
        if (!relevant) return;
        if (name === ZOTERO_WAL_FILENAME) this.#syncWalWatcher();
        this.#scheduleWatchedRefresh();
      }),
    );
    this.#watchers.push(
      watch(this.#sourcePath, WATCH_OPTIONS, (event) => {
        logger.trace("Database file watcher event", { event });
        this.#scheduleWatchedRefresh();
      }),
    );
    this.#syncWalWatcher();
  }

  #watchedFilename(name: string | undefined): boolean {
    if (name === ZOTERO_DB_FILENAME) return true;
    // Immutable reads ignore the live WAL, so WAL churn can't change what we'd
    // read — only the main DB file is worth watching in that mode.
    return this.#readMode !== "immutable" && name === ZOTERO_WAL_FILENAME;
  }

  #syncWalWatcher(): void {
    if (!this.#sourcePath || this.#readMode === "immutable") {
      this.#closeWalWatcher();
      return;
    }
    const walPath = join(dirname(this.#sourcePath), ZOTERO_WAL_FILENAME);
    if (!existsSync(walPath)) {
      logger.debug("WAL file absent, closing WAL watcher", { walPath });
      this.#closeWalWatcher();
      return;
    }
    if (this.#walWatcher) return;
    try {
      this.#walWatcher = watch(walPath, WATCH_OPTIONS, (event) => {
        logger.trace("WAL watcher event", { event });
        this.#scheduleWatchedRefresh();
      });
      logger.debug("WAL watcher opened", { walPath });
    } catch (error) {
      logger.warn("Failed to watch Zotero WAL", { error, walPath });
    }
  }

  #scheduleWatchedRefresh(): void {
    const rescheduled = !!this.#watchTimer;
    if (this.#watchTimer) window.clearTimeout(this.#watchTimer);
    this.#watchTimer = window.setTimeout(() => {
      this.#watchTimer = null;
      logger.debug("Watcher debounce elapsed, scheduling refresh");
      this.#scheduleRefresh();
    }, WATCH_DEBOUNCE_MS);
    logger.trace("Watch debounce timer {action}", {
      action: rescheduled ? "reset" : "started",
      debounceMs: WATCH_DEBOUNCE_MS,
    });
  }

  #disposeWatchers(): void {
    const watcherCount = this.#watchers.length;
    const hadPendingTimer = !!this.#watchTimer;
    const hadWalWatcher = !!this.#walWatcher;
    if (this.#watchTimer) {
      window.clearTimeout(this.#watchTimer);
      this.#watchTimer = null;
    }
    for (const watcher of this.#watchers) watcher.close();
    this.#watchers = [];
    this.#closeWalWatcher();
    if (watcherCount > 0 || hadPendingTimer || hadWalWatcher) {
      logger.debug("Database watchers disposed", {
        watcherCount,
        hadPendingTimer,
        hadWalWatcher,
      });
    }
  }

  #closeWalWatcher(): void {
    this.#walWatcher?.close();
    this.#walWatcher = null;
  }
}
