import { existsSync, watch } from "node:fs";
import type { FSWatcher, WatchOptions } from "node:fs";
import { dirname, join } from "node:path";

import { getSchemaVersions, SUPPORTED_SCHEMA_VERSIONS } from "@zotlit/db";
import type { ZoteroSchemaVersions } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import type {
  DatabaseOptions,
  NodeDatabaseClient,
} from "@zotlit/db/client/node";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { ZOTERO_DB_FILENAME, ZOTERO_WAL_FILENAME } from "@/lib/constants";
import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";
import type { Settings, SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { readParentBeside } from "./read-parent";
import {
  buildSqliteUri,
  prepareRead,
  snapshotSource,
  sourceFingerprintsEqual,
  walGenerationSize,
} from "./read-source";
import type {
  ConfiguredReadMode,
  EffectiveReadMode,
  PreparedRead,
  ReadFallbackReason,
  SourceFingerprint,
} from "./read-source";
import { reapReadClones } from "./reap-temps";

const logger = getLogger("database");
const DB_OPTIONS: DatabaseOptions = {
  jit: true,
};
const WATCH_DEBOUNCE_MS = 1200;
// Immutable mode never clones, so there is no self-echo to outwait: an fs
// tick fires when the main file itself changed, and the companion sends its
// Freshness Signal only after its Checkpoint attempt settles. Nothing here
// waits on another application; the debounce only coalesces event bursts.
const IMMUTABLE_WATCH_DEBOUNCE_MS = 300;
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

/** A change signal travelling from a watcher or a push to the refresh gate. */
interface WatchSignal {
  /**
   * Skip the fingerprint gate; the signal carries its own authority (a Zotero
   * push). Filesystem ticks are never trusted.
   */
  trusted: boolean;
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
  #watchTrusted = false;
  #sourceFingerprint: SourceFingerprint | null = null;
  #schemaVersions: ZoteroSchemaVersions | null = null;
  #refreshInFlight: Promise<void> | null = null;
  #refreshAgain = false;
  #leaseCount = 0;
  #deferredRefresh: PromiseWithResolvers<void> | null = null;
  #torndown = false;
  #lastSourcePath: string | null = null;
  #sweptReadParent: string | null = null;
  #lastConfiguredMode: ConfiguredReadMode | null = null;
  #lastAutoRefresh: boolean | null = null;
  readonly #loggedReadFallbacks = new Set<ReadFallbackReason>();
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
   *
   * Trusted: a push reports what Zotero did, so it bypasses the fingerprint gate
   * that filters the watchers' self-echo.
   */
  notifyExternalChange(): void {
    logger.debug("External change signalled, scheduling watched refresh");
    this.#scheduleWatchedRefresh({ trusted: true });
  }

  async #load(): Promise<void> {
    await this.#zoteroPref.ready;
    const settings = await this.#settings.loaded;

    await using stack = new AsyncDisposableStack();
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

    // Through the single-flight lane, so a change signal whose debounce elapses
    // during this first read coalesces into a trailing rerun instead of opening
    // a second, concurrent read stack.
    await this.#enqueueRefresh();
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
      this.#rebindWatchers();
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
      this.#reapReadParent(sourcePath);
      // Fingerprinted before the read, never after: a Zotero write that lands
      // while we clone then still differs from what we record, so the next
      // watcher tick refreshes instead of being gated away as our own echo.
      const fingerprint = await this.#trySnapshotSource(sourcePath);
      const prepared = refreshStack.use(
        await prepareRead(configuredMode, sourcePath),
      );
      // Teardown runs to completion while the read above is still preparing, and
      // it takes with it every handle the service knew about at that moment.
      // `refreshStack` still owns the clone, so leaving now releases the temp
      // dir and opens no client; committing past here would hand a live client
      // and watchers to a service whose disposal has already gone by.
      if (this.#torndown) {
        logger.debug("Refresh abandoned, service torn down while reading");
        return;
      }
      const uri = buildSqliteUri(prepared.path, prepared.uriOptions);
      const client = createClient(uri, DB_OPTIONS);
      refreshStack.use(client.$client);
      this.#logReadFallback(prepared);
      this.#reportSchemaVersions(client);

      const previousReadStack = this.#activeReadStack;
      // Commit the new client before releasing the old read stack.
      this.#client = client;
      this.#activeReadStack = refreshStack.move();
      this.#sourcePath = sourcePath;
      this.#readMode = prepared.effectiveMode;
      this.#sourceFingerprint = fingerprint;
      this.#state = "ready";
      this.#error = null;

      await previousReadStack?.disposeAsync();
      // Teardown reaches into that disposal too — it closes a client and removes
      // the old clone. Whatever it took, it has already taken the stack committed
      // above, so stop rather than bind watchers nothing will ever close and wake
      // subscribers that have gone with the service.
      if (this.#torndown) {
        logger.debug("Refresh abandoned, service torn down while swapping");
        return;
      }
      // Synchronous through to the emit, so the check above still holds for both.
      this.#rebindWatchers();
      this.#emitter.emit("changed");
      logger.info("Opened Zotero database", {
        sourcePath,
        readMode: this.#readMode,
      });
    } catch (cause) {
      // A read that fails after teardown has no subscriber left to tell.
      // Reporting it would degrade a service that is already disposed and hand
      // `refresh()` a misleading throw.
      if (this.#torndown) {
        logger.debug("Refresh failed after teardown, staying quiet", { cause });
        return;
      }
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
   * A snapshot placed beside the database leaves its residue there, where the
   * plugin-load sweep of the system temp folder never looks. Sweep that parent
   * whenever the bound database path moves it, so a crashed session leaves
   * nothing next to the user's Zotero data and a newly bound path is cleared
   * too. Fire-and-forget, as at load: a sweep never throws, and a refresh never
   * waits on housekeeping.
   *
   * Residue is recognized by owner PID, which is meaningful on one machine only.
   * A data directory shared live between two machines — an external drive that
   * is also cloud-synced — can therefore read the other machine's PID as dead.
   * The divert gate keeps that setup rare: a synced folder normally sits on the
   * OS volume, where snapshots never leave the temp folder in the first place.
   *
   * @see {@link reapReadClones} for what counts as residue.
   */
  #reapReadParent(sourcePath: string): void {
    const parent = readParentBeside(sourcePath);
    if (parent === this.#sweptReadParent) return;
    this.#sweptReadParent = parent;
    logger.debug("Sweeping read snapshots beside the database", { parent });
    void reapReadClones({ parent });
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

  /**
   * Records the Zotero schema versions once per distinct pair — on the first
   * read, and again if Zotero migrates the database mid-session. `info` while
   * the versions stay inside the verified range, `warn` once they leave it,
   * where a query may read the wrong shape. The read proceeds either way, and a
   * failed check never fails the refresh: an unreadable `version` table says
   * nothing about the tables the queries use.
   */
  #reportSchemaVersions(client: NodeDatabaseClient): void {
    let versions: ZoteroSchemaVersions;
    try {
      versions = getSchemaVersions(client);
    } catch (error) {
      logger.debug("Zotero schema version unreadable", { error });
      return;
    }
    const previous = this.#schemaVersions;
    this.#schemaVersions = versions;
    if (
      previous?.userdata === versions.userdata &&
      previous.compatibility === versions.compatibility
    )
      return;
    const fields = { ...versions, supportedRange: SUPPORTED_SCHEMA_VERSIONS };
    if (versions.supported)
      logger.info(
        "Zotero schema version is within the supported range",
        fields,
      );
    else
      logger.warn(
        "Zotero schema version is outside the range ZotLit is verified against",
        fields,
      );
  }

  #logReadFallback(prepared: PreparedRead): void {
    if (!prepared.fallbackReason) return;
    if (this.#loggedReadFallbacks.has(prepared.fallbackReason)) return;
    this.#loggedReadFallbacks.add(prepared.fallbackReason);
    logger.warn("Database read mode fell back", {
      fallbackReason: prepared.fallbackReason,
      effectiveMode: prepared.effectiveMode,
    });
  }

  /**
   * Rebinds after a successful swap so watchers always track the now-active
   * source path and effective mode. Auto-refresh off means no watchers at all.
   * macOS FSEvents reports WAL checkpoints and VACUUM replacement through
   * different watch targets, so the parent directory, DB file, and live WAL file
   * each cover blind spots in the others.
   */
  #rebindWatchers(): void {
    this.#closeWatchers();
    const settings = this.#settings.current;
    if (!settings?.["zotero.auto-refresh"]) {
      logger.debug("Auto-refresh disabled, skipping watcher bind");
      // A tick the just-closed watchers armed has no standing once auto-refresh
      // is off. A pending push keeps its own, being independent of the flag.
      if (!this.#watchTrusted) this.#cancelWatchTimer();
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
        this.#scheduleWatchedRefresh({ trusted: false });
      }),
    );
    this.#watchers.push(
      watch(this.#sourcePath, WATCH_OPTIONS, (event) => {
        logger.trace("Database file watcher event", { event });
        this.#scheduleWatchedRefresh({ trusted: false });
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
        this.#scheduleWatchedRefresh({ trusted: false });
      });
      logger.debug("WAL watcher opened", { walPath });
    } catch (error) {
      logger.warn("Failed to watch Zotero WAL", { error, walPath });
    }
  }

  /**
   * Debounce a change signal, then refresh only if the source really moved.
   *
   * Reading the database clones it, and on APFS a clone raises a `change` event
   * against the *source*, so every refresh manufactures the very event the
   * watchers listen for. A tick therefore proves nothing on its own, and the
   * gate holds it against the last read. Keep the gate: ungated, the echo drove
   * a refresh roughly every five seconds on an untouched database.
   *
   * One trusted signal in a burst carries the whole burst past the gate.
   */
  #scheduleWatchedRefresh({ trusted }: WatchSignal): void {
    const rescheduled = !!this.#watchTimer;
    if (this.#watchTimer) window.clearTimeout(this.#watchTimer);
    this.#watchTrusted ||= trusted;
    const debounceMs =
      this.#readMode === "immutable"
        ? IMMUTABLE_WATCH_DEBOUNCE_MS
        : WATCH_DEBOUNCE_MS;
    this.#watchTimer = window.setTimeout(() => {
      this.#watchTimer = null;
      const wasTrusted = this.#watchTrusted;
      this.#watchTrusted = false;
      void this.#refreshIfSourceMoved({ trusted: wasTrusted });
    }, debounceMs);
    logger.trace("Watch debounce timer {action}", {
      action: rescheduled ? "reset" : "started",
      debounceMs,
    });
  }

  async #refreshIfSourceMoved({ trusted }: WatchSignal): Promise<void> {
    if (!trusted) {
      const sourceMoved = await this.#sourceMoved();
      if (this.#readMode !== "immutable" && !sourceMoved) {
        logger.debug(
          "Watcher tick ignored, database unchanged since last read",
        );
        return;
      }
    }
    // Both rechecked after the gate's await. The timer clears itself before that
    // await, so `#cancelWatchTimer` can no longer stop a tick inside it, and the
    // tick must check for itself: a refresh started now would build a client no
    // disposal stack still owns, or resume watching a source the user just
    // stopped watching. A trusted push skips the auto-refresh check.
    if (this.#torndown) {
      logger.debug("Watcher tick ignored, service torn down");
      return;
    }
    if (!trusted && !this.#settings.current?.["zotero.auto-refresh"]) {
      logger.debug("Watcher tick ignored, auto-refresh switched off");
      return;
    }
    logger.debug("Watcher debounce elapsed, scheduling refresh");
    this.#scheduleRefresh();
  }

  /**
   * Fails open: with no fingerprint to compare against, or when the source
   * cannot be read, refresh anyway. A spare refresh costs work; a missed one
   * serves stale data until something else happens to wake the watchers.
   */
  async #sourceMoved(): Promise<boolean> {
    const previous = this.#sourceFingerprint;
    const current = await this.#trySnapshotSource(
      this.#zoteroPref.databasePath,
    );
    const moved =
      !previous || !current || !sourceFingerprintsEqual(previous, current);
    logger.debug("Watcher source fingerprint checked", {
      verdict: moved ? "changed" : "unchanged",
      readMode: this.#readMode,
      previousWalState: previous?.wal.state ?? "unavailable",
      previousWalSize: walGenerationSize(previous?.wal),
      currentWalState: current?.wal.state ?? "unavailable",
      currentWalSize: walGenerationSize(current?.wal),
    });
    return moved;
  }

  /** Fail-soft {@link snapshotSource}: `null` where that function would throw. */
  async #trySnapshotSource(
    sourcePath: string,
  ): Promise<SourceFingerprint | null> {
    try {
      return await snapshotSource(sourcePath);
    } catch (error) {
      logger.debug("Failed to fingerprint the Zotero database", { error });
      return null;
    }
  }

  #disposeWatchers(): void {
    this.#closeWatchers();
    this.#cancelWatchTimer();
  }

  /**
   * Closes the watchers and leaves any armed debounce running: a rebind follows
   * every successful refresh, and a tick armed mid-refresh must survive it —
   * the fresh watchers never saw the write that armed it, so cancelling here
   * loses that write. The fingerprint gate makes the surviving tick cheap; one
   * that finds an unchanged source refreshes nothing. Use {@link #disposeWatchers}
   * where the tick should die with the watchers.
   */
  #closeWatchers(): void {
    const watcherCount = this.#watchers.length;
    const hadWalWatcher = !!this.#walWatcher;
    for (const watcher of this.#watchers) watcher.close();
    this.#watchers = [];
    this.#closeWalWatcher();
    if (watcherCount > 0 || hadWalWatcher) {
      logger.debug("Database watchers closed", { watcherCount, hadWalWatcher });
    }
  }

  #cancelWatchTimer(): void {
    if (this.#watchTimer) {
      window.clearTimeout(this.#watchTimer);
      logger.debug("Pending watcher tick cancelled", {
        trusted: this.#watchTrusted,
      });
    }
    this.#watchTimer = null;
    this.#watchTrusted = false;
  }

  #closeWalWatcher(): void {
    this.#walWatcher?.close();
    this.#walWatcher = null;
  }
}
