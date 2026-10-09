// The production Connection: owns the Zotero database source — Read Mode, fingerprints, watchers, and the refresh lane.
import { Deferred, Effect, FiberSet, Layer } from "effect";
import type { Fiber } from "effect";
import { existsSync, watch } from "node:fs";
import type { WatchListener, WatchOptionsWithStringEncoding } from "node:fs";
import { dirname, join } from "node:path";

import { getSchemaVersions, SUPPORTED_SCHEMA_VERSIONS } from "@zotlit/db";
import type { ZoteroSchemaVersions } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { ZOTERO_DB_FILENAME, ZOTERO_WAL_FILENAME } from "@/lib/constants";
import { getLogger } from "@/lib/log";
import { readParentBeside } from "@/services/database/read-parent";
import {
  buildSqliteUri,
  prepareRead,
  snapshotSource,
  sourceFingerprintsEqual,
  walGenerationSize,
} from "@/services/database/read-source";
import type {
  EffectiveReadMode,
  PreparedRead,
  ReadFallbackReason,
  SourceFingerprint,
} from "@/services/database/read-source";
import { reapReadClones } from "@/services/database/reap-temps";

import { makeStateFeed } from "./change-feed";
import {
  Connection,
  makeClientRef,
  makeDatabaseGenerations,
  toDbUnavailable,
  validateClient,
} from "./connection";
import type { OpenClient } from "./connection";
import { DbUnavailable } from "./rpc";
import type { ReadsConfig } from "./rpc";

const logger = getLogger("zotero-reads");

const WATCH_DEBOUNCE_MS = 1200;
// Immutable mode never clones, so there is no self-echo to outwait: an fs
// tick fires when the main file itself changed, and the companion sends its
// Freshness Signal only after its Checkpoint attempt settles. Nothing here
// waits on another application; the debounce only coalesces event bursts.
const IMMUTABLE_WATCH_DEBOUNCE_MS = 300;
// `persistent: false` so no watcher keeps the event loop alive on its own.
const WATCH_OPTIONS: WatchOptionsWithStringEncoding = { persistent: false };

/** A watcher the source can close; the part of `fs.FSWatcher` it uses. */
interface Watcher {
  close(): void;
}

/** The file-system and SQLite operations the source runs; tests swap them. */
export interface SourcePorts {
  prepareRead: (
    mode: ReadsConfig["readMode"],
    path: string,
  ) => Promise<PreparedRead>;
  snapshotSource: (path: string) => Promise<SourceFingerprint>;
  createClient: (uri: string) => NodeDatabaseClient;
  watch: (
    path: string,
    options: WatchOptionsWithStringEncoding,
    listener: WatchListener<string>,
  ) => Watcher;
  existsSync: (path: string) => boolean;
  reapReadClones: (options: { parent: string }) => Promise<unknown>;
}

const defaultPorts: SourcePorts = {
  prepareRead,
  snapshotSource,
  createClient: (uri) => createClient(uri, { jit: true }),
  watch,
  existsSync,
  reapReadClones,
};

export interface SourceOptions {
  /** @default the real file system and SQLite */
  ports?: Partial<SourcePorts>;
  /** The settings to open first; without them the source waits for `Configure`. */
  initial?: ReadsConfig | null;
}

/** A change signal travelling from a watcher or a push to the refresh gate. */
interface WatchSignal {
  /**
   * Skip the fingerprint gate; the signal carries its own authority (a Zotero
   * push). Filesystem ticks are never trusted.
   */
  trusted: boolean;
}

/**
 * Settle a promise-returning open as an Effect. An interrupt abandons the
 * wait, and a read that lands after it is released at once, so teardown never
 * waits on a slow clone and never leaks one.
 */
function prepareDetached(
  open: () => Promise<PreparedRead>,
): Effect.Effect<PreparedRead, DbUnavailable> {
  return Effect.callback<PreparedRead, DbUnavailable>((resume) => {
    let abandoned = false;
    open().then(
      (read) => {
        if (abandoned) void disposeRead(read);
        else resume(Effect.succeed(read));
      },
      (cause: unknown) => {
        if (!abandoned) resume(Effect.fail(toDbUnavailable(cause)));
      },
    );
    return Effect.sync(() => {
      abandoned = true;
    });
  });
}

async function disposeRead(read: PreparedRead): Promise<void> {
  try {
    await read[Symbol.asyncDispose]();
  } catch (error) {
    logger.warn("Failed to release a database read snapshot", { error });
  }
}

/**
 * A {@link Connection} that owns the Zotero database source: it selects the
 * Read Mode, fingerprints the source, binds `fs.watch` with the self-echo
 * gate, and runs every refresh through one debounced, single-flight lane. A
 * refresh validates the new source before it swaps; a failed one keeps the
 * previous client serving.
 */
export function layerSource(options?: SourceOptions): Layer.Layer<Connection> {
  const ports: SourcePorts = { ...defaultPorts, ...options?.ports };

  return Layer.effect(Connection)(
    Effect.gen(function* () {
      let config: ReadsConfig | null = null;
      let state: "loading" | "ready" | "degraded" = "loading";
      let lastError: DbUnavailable | null = null;
      let hasClient = false;
      let sourcePath: string | null = null;
      let readMode: EffectiveReadMode | null = null;
      let fingerprint: SourceFingerprint | null = null;
      let schemaVersions: ZoteroSchemaVersions | null = null;
      let sweptReadParent: string | null = null;
      let missingDbSignalled = false;
      const loggedFallbacks = new Set<ReadFallbackReason>();

      let watchers: Watcher[] = [];
      let walWatcher: Watcher | null = null;
      let watchTimer: Fiber.Fiber<void> | null = null;
      let watchTrusted = false;

      /** The running lane's completion, while one runs. */
      let laneDone: Deferred.Deferred<void, DbUnavailable> | null = null;
      let refreshAgain = false;
      /** Why the lane's latest refresh failed; `null` once one succeeds. */
      let laneFailure: DbUnavailable | null = null;
      /** Completes once the first refresh settled, either way. */
      const firstSettled = yield* Deferred.make<void>();

      // Teardown runs these finalizers in reverse: the flag flips, the fiber
      // set interrupts every lane and tick (waiting out an open that is
      // handing its client over), then the client ref closes every client,
      // and the watchers close last, so nothing binds or opens behind them.
      yield* Effect.addFinalizer(() => Effect.sync(() => disposeWatchers()));
      const { publish, changes } = yield* makeStateFeed(() => ({
        state,
        error: lastError,
        readMode,
        missing: missingDbSignalled,
      }));
      const databaseGenerations = makeDatabaseGenerations();
      const clients = yield* makeClientRef(
        Effect.suspend(() =>
          Effect.fail(
            lastError ??
              new DbUnavailable({ message: "No database source is open" }),
          ),
        ),
      );
      const fibers = yield* FiberSet.make();
      const run = yield* FiberSet.runtime(fibers)();
      let torndown = false;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          torndown = true;
        }),
      );

      // --- Opening ----------------------------------------------------------

      /**
       * A snapshot placed beside the database leaves its residue there, where
       * the plugin-load sweep of the system temp folder never looks. Sweep
       * that parent whenever the bound database path moves it.
       *
       * @see {@link reapReadClones} for what counts as residue.
       */
      const reapReadParent = (path: string): void => {
        const parent = readParentBeside(path);
        if (parent === sweptReadParent) return;
        sweptReadParent = parent;
        logger.debug("Sweeping read snapshots beside the database", {
          parent,
        });
        run(
          Effect.promise(() =>
            ports.reapReadClones({ parent }).catch((error: unknown) => {
              logger.debug("Read snapshot sweep failed", { error });
            }),
          ),
        );
      };

      /** Fail-soft {@link snapshotSource}: `null` where that function would throw. */
      const trySnapshotSource = (path: string) =>
        Effect.promise(() =>
          ports.snapshotSource(path).catch((error: unknown) => {
            logger.debug("Failed to fingerprint the Zotero database", {
              error,
            });
            return null;
          }),
        );

      /**
       * Records the Zotero schema versions once per distinct pair. The stamps
       * come from the layout that {@link validateClient} read for this client,
       * so no statement runs here. A failed check never fails the refresh.
       */
      const reportSchemaVersions = (client: NodeDatabaseClient): void => {
        let versions: ZoteroSchemaVersions;
        try {
          versions = getSchemaVersions(client);
        } catch (error) {
          logger.debug("Zotero schema version unreadable", { error });
          return;
        }
        const previous = schemaVersions;
        schemaVersions = versions;
        if (
          previous?.userdata === versions.userdata &&
          previous.compatibility === versions.compatibility
        )
          return;
        const fields = {
          ...versions,
          supportedRange: SUPPORTED_SCHEMA_VERSIONS,
        };
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
      };

      const logReadFallback = (prepared: PreparedRead): void => {
        if (!prepared.fallbackReason) return;
        if (loggedFallbacks.has(prepared.fallbackReason)) return;
        loggedFallbacks.add(prepared.fallbackReason);
        logger.warn("Database read mode fell back", {
          fallbackReason: prepared.fallbackReason,
          effectiveMode: prepared.effectiveMode,
        });
      };

      /**
       * Open and validate a client over a prepared read of `file`, recording
       * the database it reads; on failure release both.
       */
      const openClient = (prepared: PreparedRead, file: string) =>
        Effect.tryPromise({
          try: async (): Promise<OpenClient> => {
            let client: NodeDatabaseClient;
            try {
              client = validateClient(
                ports.createClient(
                  buildSqliteUri(prepared.path, prepared.uriOptions),
                ),
              );
              databaseGenerations.record(client, file);
            } catch (error) {
              await disposeRead(prepared);
              throw error;
            }
            return {
              client,
              close: Effect.promise(async () => {
                client.$client.close();
                await disposeRead(prepared);
              }),
            };
          },
          catch: toDbUnavailable,
        });

      /**
       * Fresh-device handling: when a refresh fails because the database file
       * is absent, emit `db-file-missing` at most once per source lifetime.
       */
      const maybeSignalMissingDatabase = (path: string) =>
        Effect.suspend(() => {
          if (missingDbSignalled || ports.existsSync(path)) return Effect.void;
          missingDbSignalled = true;
          logger.info("Zotero database not found on this device", {
            dbPath: path,
          });
          return publish({ _tag: "db-file-missing" });
        });

      const refreshOnce = Effect.gen(function* () {
        const current = config;
        if (!current) return;
        const { databasePath, readMode: configuredMode } = current;
        reapReadParent(databasePath);
        // Fingerprinted before the read, never after: a Zotero write that
        // lands while we clone then still differs from what we record, so the
        // next watcher tick refreshes instead of being gated away as our echo.
        const nextFingerprint = yield* trySnapshotSource(databasePath);
        const result = yield* Effect.result(
          Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const prepared = yield* restore(
                prepareDetached(() =>
                  ports.prepareRead(configuredMode, databasePath),
                ),
              );
              const open = yield* openClient(prepared, databasePath);
              logReadFallback(prepared);
              reportSchemaVersions(open.client);
              yield* clients.swap(open);
              hasClient = true;
              laneFailure = null;
              sourcePath = databasePath;
              readMode = prepared.effectiveMode;
              fingerprint = nextFingerprint;
              state = "ready";
              lastError = null;
            }),
          ),
        );
        // Teardown waited for the uninterruptible open above; whatever it
        // took, it has taken, so bind and report nothing more.
        if (torndown) return;
        if (result._tag === "Failure") {
          const error = result.failure;
          yield* publish({ _tag: "refresh-failed", error });
          logger.warn("Failed to refresh Zotero database", { error });
          yield* maybeSignalMissingDatabase(databasePath);
          laneFailure = error;
          // Keep serving the previous client on a failed refresh; only go
          // degraded when there was never a working client to fall back to.
          lastError = error;
          if (!hasClient) {
            state = "degraded";
            disposeWatchers();
            yield* publish({ _tag: "degraded", error });
          }
          return;
        }
        rebindWatchers();
        yield* publish({
          _tag: "changed",
          ...(readMode && { readMode }),
        });
        logger.info("Opened Zotero database", {
          sourcePath: databasePath,
          readMode,
        });
      }).pipe(Effect.ensuring(Deferred.succeed(firstSettled, undefined)));

      const refreshLane = Effect.gen(function* () {
        yield* publish({ _tag: "refreshing", active: true });
        do {
          refreshAgain = false;
          yield* refreshOnce;
          if (refreshAgain)
            logger.debug("Trailing request queued, rerunning refresh");
        } while (refreshAgain);
      }).pipe(Effect.ensuring(publish({ _tag: "refreshing", active: false })));

      /**
       * Single-flight refresh lane with trailing-rerun coalescing: every
       * trigger shares one in-flight run, and a trigger mid-run sets one
       * trailing rerun. Returns the run's completion.
       */
      const enqueueRefresh = (): Deferred.Deferred<void, DbUnavailable> => {
        if (laneDone) {
          logger.debug("Refresh in flight, coalescing trailing rerun");
          refreshAgain = true;
          return laneDone;
        }
        const done = Deferred.makeUnsafe<void, DbUnavailable>();
        laneDone = done;
        run(
          refreshLane.pipe(
            Effect.ensuring(
              Effect.suspend(() => {
                laneDone = null;
                const failure = laneFailure;
                laneFailure = null;
                return failure
                  ? Deferred.fail(done, failure)
                  : Deferred.succeed(done, undefined);
              }),
            ),
          ),
        );
        return done;
      };

      // --- Watching ---------------------------------------------------------

      const closeWalWatcher = (): void => {
        walWatcher?.close();
        walWatcher = null;
      };

      /**
       * Closes the watchers and leaves any armed debounce running: a rebind
       * follows every successful refresh, and a tick armed mid-refresh must
       * survive it, or the write that armed it goes unseen.
       */
      const closeWatchers = (): void => {
        for (const watcher of watchers) watcher.close();
        watchers = [];
        closeWalWatcher();
      };

      const cancelWatchTimer = (): void => {
        watchTimer?.interruptUnsafe();
        watchTimer = null;
        watchTrusted = false;
      };

      function disposeWatchers(): void {
        closeWatchers();
        cancelWatchTimer();
      }

      /**
       * Fails open: with no fingerprint to compare against, or when the
       * source cannot be read, refresh anyway.
       */
      const sourceMoved = Effect.gen(function* () {
        const previous = fingerprint;
        const path = config?.databasePath;
        const current = path ? yield* trySnapshotSource(path) : null;
        const moved =
          !previous || !current || !sourceFingerprintsEqual(previous, current);
        logger.debug("Watcher source fingerprint checked", {
          verdict: moved ? "changed" : "unchanged",
          readMode,
          previousWalSize: walGenerationSize(previous?.wal),
          currentWalSize: walGenerationSize(current?.wal),
        });
        return moved;
      });

      const refreshIfSourceMoved = Effect.fnUntraced(function* ({
        trusted,
      }: WatchSignal) {
        if (!trusted) {
          const moved = yield* sourceMoved;
          if (readMode !== "immutable" && !moved) {
            logger.debug(
              "Watcher tick ignored, database unchanged since last read",
            );
            return;
          }
        }
        // Rechecked after the gate's await: the timer cleared itself before
        // it, so switching auto-refresh off could no longer cancel it.
        if (!trusted && !config?.autoRefresh) {
          logger.debug("Watcher tick ignored, auto-refresh switched off");
          return;
        }
        enqueueRefresh();
      });

      /**
       * Debounce a change signal, then refresh only if the source really
       * moved. Reading the database clones it, and on APFS a clone raises a
       * `change` event against the source, so a tick proves nothing on its
       * own; the gate holds it against the last read. One trusted signal in a
       * burst carries the whole burst past the gate.
       */
      const scheduleWatchedRefresh = ({ trusted }: WatchSignal): void => {
        watchTimer?.interruptUnsafe();
        watchTrusted ||= trusted;
        const debounceMs =
          readMode === "immutable"
            ? IMMUTABLE_WATCH_DEBOUNCE_MS
            : WATCH_DEBOUNCE_MS;
        watchTimer = run(
          Effect.andThen(
            Effect.sleep(debounceMs),
            Effect.suspend(() => {
              watchTimer = null;
              const wasTrusted = watchTrusted;
              watchTrusted = false;
              return refreshIfSourceMoved({ trusted: wasTrusted });
            }),
          ),
        );
      };

      const watchedFilename = (name: string | undefined): boolean => {
        if (name === ZOTERO_DB_FILENAME) return true;
        // Immutable reads ignore the live WAL, so WAL churn can't change what
        // we'd read; only the main DB file is worth watching in that mode.
        return readMode !== "immutable" && name === ZOTERO_WAL_FILENAME;
      };

      const syncWalWatcher = (): void => {
        if (!sourcePath || readMode === "immutable") {
          closeWalWatcher();
          return;
        }
        const walPath = join(dirname(sourcePath), ZOTERO_WAL_FILENAME);
        if (!ports.existsSync(walPath)) {
          closeWalWatcher();
          return;
        }
        if (walWatcher) return;
        try {
          walWatcher = ports.watch(walPath, WATCH_OPTIONS, () =>
            scheduleWatchedRefresh({ trusted: false }),
          );
        } catch (error) {
          logger.warn("Failed to watch Zotero WAL", { error, walPath });
        }
      };

      /**
       * Rebinds after a successful swap so watchers track the active source
       * path and effective mode. Auto-refresh off means no watchers at all.
       * macOS FSEvents reports WAL checkpoints and VACUUM replacement through
       * different targets, so the parent directory, DB file, and live WAL file
       * each cover blind spots in the others.
       */
      function rebindWatchers(): void {
        closeWatchers();
        if (!config?.autoRefresh) {
          // A tick the just-closed watchers armed has no standing once
          // auto-refresh is off. A pending push keeps its own.
          if (!watchTrusted) cancelWatchTimer();
          return;
        }
        if (!sourcePath || !readMode) return;
        const parent = dirname(sourcePath);
        try {
          // One push per watcher, so a throw on the second still leaves the
          // first owned and closed.
          watchers.push(
            ports.watch(parent, WATCH_OPTIONS, (_event, filename) => {
              const name = filename?.toString();
              if (!watchedFilename(name)) return;
              if (name === ZOTERO_WAL_FILENAME) syncWalWatcher();
              scheduleWatchedRefresh({ trusted: false });
            }),
          );
          watchers.push(
            ports.watch(sourcePath, WATCH_OPTIONS, () =>
              scheduleWatchedRefresh({ trusted: false }),
            ),
          );
        } catch (error) {
          logger.warn("Failed to watch the Zotero database", { error });
        }
        syncWalWatcher();
      }

      // --- Configuration ----------------------------------------------------

      const configure = (next: ReadsConfig) =>
        Effect.sync(() => {
          const previous = config;
          config = next;
          if (!previous) {
            enqueueRefresh();
            return;
          }
          if (next.autoRefresh !== previous.autoRefresh) {
            logger.debug("Auto-refresh setting changed", {
              next: next.autoRefresh,
            });
            rebindWatchers();
          }
          if (
            next.databasePath !== previous.databasePath ||
            next.readMode !== previous.readMode
          ) {
            logger.debug("Database source changed", {
              databasePath: next.databasePath,
              readMode: next.readMode,
            });
            enqueueRefresh();
          }
        });

      if (options?.initial) yield* configure(options.initial);

      return Connection.of({
        // A read before the first open waits for it, as callers once awaited
        // the service's `ready`.
        borrow: Effect.andThen(Deferred.await(firstSettled), clients.borrow),
        changes,
        // Fails when the lane's last refresh failed, also when the previous
        // client keeps serving; `Changes` tells the two apart.
        refresh: Effect.suspend(() => Deferred.await(enqueueRefresh())),
        notifyExternalChange: Effect.sync(() => {
          logger.debug("External change signalled, scheduling refresh");
          scheduleWatchedRefresh({ trusted: true });
        }),
        configure,
        databaseGeneration: databaseGenerations.databaseGeneration,
        databaseFile: databaseGenerations.databaseFile,
      });
    }),
  );
}
