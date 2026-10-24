import { existsSync, watch } from "node:fs";
import type { WatchListener, WatchOptionsWithStringEncoding } from "node:fs";
import { dirname, join } from "node:path";

import { getSchemaVersions, SUPPORTED_SCHEMA_VERSIONS } from "@zotlit/db";
import type { ZoteroSchemaVersions } from "@zotlit/db";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { ZOTERO_DB_FILENAME, ZOTERO_WAL_FILENAME } from "@/lib/constants";
// The production Connection: owns the Zotero database source — Read Mode, fingerprints, watchers, and the refresh lane.
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Ref,
  Scope,
  Stream,
  SynchronizedRef,
} from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log-category";
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
import { reapReadClonesEffect } from "@/services/database/reap-temps";

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

const WATCH_DEBOUNCE_MS = 1200;
// Immutable mode never clones, so there is no self-echo to outwait: an fs
// tick fires when the main file itself changed, and the companion sends its
// Freshness Signal only after its Checkpoint attempt settles. Nothing here
// waits on another application; the debounce only coalesces event bursts.
const IMMUTABLE_WATCH_DEBOUNCE_MS = 300;
// `persistent: false` so no watcher keeps the event loop alive on its own.
const WATCH_OPTIONS: WatchOptionsWithStringEncoding = { persistent: false };

const logDebug = (message: string, annotations: Record<string, unknown> = {}) =>
  Effect.logDebug(message).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("zotero-reads"),
  );

const logInfo = (message: string, annotations: Record<string, unknown> = {}) =>
  Effect.logInfo(message).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("zotero-reads"),
  );

const logWarning = (
  message: string,
  annotations: Record<string, unknown> = {},
) =>
  Effect.logWarning(message).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("zotero-reads"),
  );

const logWarningCause = (
  message: string,
  error: unknown,
  annotations: Record<string, unknown> = {},
) =>
  Effect.logWarning(message, Cause.fail(error)).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("zotero-reads"),
  );

/** A watcher the source can close; the part of `fs.FSWatcher` it uses. */
interface Watcher {
  close(): void;
}

/** The file-system and SQLite operations the source runs; tests swap them. */
export interface SourcePorts {
  prepareRead: (
    mode: ReadsConfig["readMode"],
    path: string,
  ) => Effect.Effect<PreparedRead, DbUnavailable, Scope.Scope>;
  snapshotSource: (
    path: string,
  ) => Effect.Effect<SourceFingerprint, DbUnavailable>;
  createClient: (uri: string) => NodeDatabaseClient;
  watch: (
    path: string,
    options: WatchOptionsWithStringEncoding,
    listener: WatchListener<string>,
  ) => Watcher;
  existsSync: (path: string) => boolean;
  reapReadClones: (options: {
    parent: string;
  }) => Effect.Effect<unknown, DbUnavailable>;
}

const defaultPorts: SourcePorts = {
  prepareRead,
  snapshotSource,
  createClient: (uri) => createClient(uri, { jit: true }),
  watch,
  existsSync,
  reapReadClones: reapReadClonesEffect,
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
   * A Zotero push can refresh even with automatic file watching disabled.
   * Its source fingerprint is checked inside the refresh lane.
   */
  trusted: boolean;
  /** The file name an `fs.watch` callback reported. */
  filename?: string;
}

interface RefreshLaneState {
  done: Deferred.Deferred<void, DbUnavailable> | null;
  again: boolean;
  failure: DbUnavailable | null;
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
      const lifetime = yield* Scope.Scope;
      const state = yield* Ref.make<{
        config: ReadsConfig | null;
        state: "loading" | "ready" | "degraded";
        lastError: DbUnavailable | null;
        hasClient: boolean;
        sourcePath: string | null;
        moved: boolean;
        readMode: EffectiveReadMode | null;
        fingerprint: SourceFingerprint | null;
        schemaVersions: ZoteroSchemaVersions | null;
        sweptReadParent: string | null;
        missingDbSignalled: boolean;
      }>({
        config: null,
        state: "loading",
        lastError: null,
        hasClient: false,
        sourcePath: null,
        /** The last refresh failed for another database than `sourcePath`. */
        moved: false,
        readMode: null,
        fingerprint: null,
        schemaVersions: null,
        sweptReadParent: null,
        missingDbSignalled: false,
      });
      const loggedFallbacks = yield* Ref.make(new Set<ReadFallbackReason>());
      const mainWatcherScope = yield* Ref.make<Scope.Closeable | null>(null);
      const walWatcherScope = yield* Ref.make<Scope.Closeable | null>(null);
      const watchSignals = yield* Queue.unbounded<WatchSignal>();
      const watchTimer = yield* Ref.make<Fiber.Fiber<void> | null>(null);
      const watchTrusted = yield* Ref.make(false);
      const lane = yield* SynchronizedRef.make<RefreshLaneState>({
        done: null,
        again: false,
        failure: null,
      });
      /** Completes once the first refresh settled, either way. */
      const firstSettled = yield* Deferred.make<void>();

      const closeWatcherScopes = Effect.gen(function* () {
        const main = yield* Ref.getAndSet(mainWatcherScope, null);
        const wal = yield* Ref.getAndSet(walWatcherScope, null);
        yield* Effect.all(
          [
            main ? Scope.close(main, Exit.void) : Effect.void,
            wal ? Scope.close(wal, Exit.void) : Effect.void,
          ],
          { concurrency: "unbounded" },
        );
      });
      const cancelWatchTimer = Effect.gen(function* () {
        const timer = yield* Ref.getAndSet(watchTimer, null);
        yield* Ref.set(watchTrusted, false);
        if (timer) yield* Fiber.interrupt(timer);
      });
      yield* Effect.addFinalizer(() =>
        Effect.andThen(closeWatcherScopes, cancelWatchTimer),
      );
      const { publish, changes } = yield* makeStateFeed(() => {
        const current = Ref.getUnsafe(state);
        return {
          state: current.state,
          error: current.lastError,
          readMode: current.readMode,
          moved: current.moved,
          missing: current.missingDbSignalled,
        };
      });
      const databaseGenerations = makeDatabaseGenerations();
      const clients = yield* makeClientRef(
        Effect.suspend(() =>
          Effect.fail(
            Ref.getUnsafe(state).lastError ??
              new DbUnavailable({ message: "No database source is open" }),
          ),
        ),
      );

      // --- Opening ----------------------------------------------------------

      /**
       * A snapshot placed beside the database leaves its residue there, where
       * the plugin-load sweep of the system temp folder never looks. Sweep
       * that parent whenever the bound database path moves it.
       *
       * @see {@link reapReadClonesEffect} for what counts as residue.
       */
      const reapReadParent = Effect.fnUntraced(function* (path: string) {
        const parent = readParentBeside(path);
        const fresh = yield* Ref.modify(state, (current) =>
          current.sweptReadParent === parent
            ? [false, current]
            : [true, { ...current, sweptReadParent: parent }],
        );
        if (!fresh) return;
        yield* logDebug("Sweeping read snapshots beside the database", {
          parent,
        });
        yield* ports.reapReadClones({ parent }).pipe(
          Effect.catch((error) =>
            logDebug("Read snapshot sweep failed", { error }),
          ),
          Effect.forkIn(lifetime),
        );
      });

      /** Fail-soft {@link snapshotSource}: `null` where that function would throw. */
      const trySnapshotSource = (
        path: string,
      ): Effect.Effect<SourceFingerprint | null> =>
        ports.snapshotSource(path).pipe(
          Effect.catch((error) =>
            logDebug("Failed to fingerprint the Zotero database", {
              error,
            }).pipe(Effect.as(null)),
          ),
        );

      /**
       * Records the Zotero schema versions once per distinct pair. The stamps
       * come from the layout that {@link validateClient} read for this client,
       * so no statement runs here. A failed check never fails the refresh.
       */
      const reportSchemaVersions = Effect.fnUntraced(function* (
        client: NodeDatabaseClient,
      ) {
        const versions = yield* Effect.try({
          // boundary: @zotlit/db reads node:sqlite synchronously.
          try: () => getSchemaVersions(client),
          catch: (error) => error,
        }).pipe(
          Effect.catch((error) =>
            logDebug("Zotero schema version unreadable", { error }).pipe(
              Effect.as(null),
            ),
          ),
        );
        if (versions === null) return;
        const previous = yield* Ref.modify(state, (current) => [
          current.schemaVersions,
          { ...current, schemaVersions: versions },
        ]);
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
          yield* logInfo(
            "Zotero schema version is within the supported range",
            fields,
          );
        else
          yield* logWarning(
            "Zotero schema version is outside the range ZotLit is verified against",
            fields,
          );
      });

      const logReadFallback = Effect.fnUntraced(function* (
        prepared: PreparedRead,
      ) {
        if (!prepared.fallbackReason) return;
        const fresh = yield* Ref.modify(loggedFallbacks, (logged) => {
          if (logged.has(prepared.fallbackReason!)) return [false, logged];
          const next = new Set(logged);
          next.add(prepared.fallbackReason!);
          return [true, next];
        });
        if (fresh)
          yield* logWarning("Database read mode fell back", {
            fallbackReason: prepared.fallbackReason,
            effectiveMode: prepared.effectiveMode,
          });
      });

      /**
       * Open and validate a client over a prepared read of `file`, recording
       * the database it reads; on failure release both.
       */
      const openClient = Effect.fnUntraced(function* (
        readScope: Scope.Closeable,
        prepared: PreparedRead,
        file: string,
      ): Effect.fn.Return<
        OpenClient & { readonly readMode: EffectiveReadMode },
        DbUnavailable
      > {
        const clientScope = yield* Scope.make();
        return yield* Effect.onError(
          Effect.gen(function* () {
            const client = yield* Effect.acquireRelease(
              Effect.try({
                // boundary: @zotlit/db creates a synchronous node:sqlite client.
                try: () =>
                  ports.createClient(
                    buildSqliteUri(prepared.path, prepared.uriOptions),
                  ),
                catch: toDbUnavailable,
              }),
              (client) => Effect.sync(() => client.$client.close()),
            ).pipe(Scope.provide(clientScope));
            const validated = yield* validateClient(client).pipe(
              Effect.mapError(toDbUnavailable),
            );
            yield* databaseGenerations.record(validated, file);
            yield* logReadFallback(prepared);
            yield* reportSchemaVersions(validated);
            return {
              client: validated,
              readMode: prepared.effectiveMode,
              close: Scope.close(clientScope, Exit.void).pipe(
                Effect.ensuring(Scope.close(readScope, Exit.void)),
              ),
            };
          }),
          () =>
            Scope.close(clientScope, Exit.void).pipe(
              Effect.ensuring(Scope.close(readScope, Exit.void)),
            ),
        );
      });

      /**
       * Fresh-device handling: when a refresh fails because the database file
       * is absent, emit `db-file-missing` at most once per source lifetime.
       */
      const maybeSignalMissingDatabase = Effect.fnUntraced(function* (
        path: string,
      ) {
        const current = yield* Ref.get(state);
        // boundary: the source port owns the synchronous existsSync check.
        const exists = yield* Effect.sync(() => ports.existsSync(path));
        if (current.missingDbSignalled || exists) return;
        yield* Ref.update(state, (previous) => ({
          ...previous,
          missingDbSignalled: true,
        }));
        yield* logInfo("Zotero database not found on this device", {
          dbPath: path,
        });
        yield* publish({ _tag: "db-file-missing" });
      });

      const refreshOnce = Effect.fnUntraced(
        function* (skipUnchanged: boolean) {
          const before = yield* Ref.get(state);
          const current = before.config;
          if (!current) return;
          const { databasePath, readMode: configuredMode } = current;
          yield* reapReadParent(databasePath);
          // Fingerprinted before the read, never after: a Zotero write that
          // lands while we clone then still differs from what we record, so the
          // next watcher tick refreshes instead of being gated away as our echo.
          const nextFingerprint = yield* trySnapshotSource(databasePath);
          // Reuse the refresh's pre-read fingerprint. Only a healthy clone can
          // stay in place; failures, configuration changes and queued requests
          // retain the full refresh path.
          if (
            skipUnchanged &&
            !(yield* SynchronizedRef.get(lane)).again &&
            (yield* Ref.get(state)).config === current &&
            before.state === "ready" &&
            before.lastError === null &&
            before.readMode !== "immutable" &&
            before.sourcePath === databasePath &&
            before.fingerprint &&
            nextFingerprint &&
            sourceFingerprintsEqual(before.fingerprint, nextFingerprint)
          ) {
            yield* logDebug(
              "External change ignored, database unchanged since last read",
            );
            return;
          }
          const result = yield* Effect.result(
            Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const readScope = yield* Scope.make();
                const opened = yield* Effect.onError(
                  Effect.gen(function* () {
                    const prepared = yield* restore(
                      ports
                        .prepareRead(configuredMode, databasePath)
                        .pipe(Scope.provide(readScope)),
                    );
                    return yield* openClient(readScope, prepared, databasePath);
                  }),
                  () => Scope.close(readScope, Exit.void),
                );
                yield* clients.swap(opened);
                yield* SynchronizedRef.update(lane, (currentLane) => ({
                  ...currentLane,
                  failure: null,
                }));
                yield* Ref.update(state, (previous) => ({
                  ...previous,
                  hasClient: true,
                  sourcePath: databasePath,
                  readMode: opened.readMode,
                  fingerprint: nextFingerprint,
                  state: "ready" as const,
                  lastError: null,
                  moved: false,
                }));
              }),
            ),
          );
          if (result._tag === "Failure") {
            const error = result.failure;
            const currentState = yield* Ref.get(state);
            const moved =
              currentState.hasClient &&
              currentState.sourcePath !== databasePath;
            yield* publish({ _tag: "refresh-failed", error, moved });
            yield* logWarningCause("Failed to refresh Zotero database", error);
            yield* maybeSignalMissingDatabase(databasePath);
            yield* SynchronizedRef.update(lane, (currentLane) => ({
              ...currentLane,
              failure: error,
            }));
            // Keep serving the previous client on a failed refresh; only go
            // degraded when there was never a working client to fall back to.
            const after = yield* Ref.modify(state, (previous) => [
              { hasClient: previous.hasClient },
              {
                ...previous,
                lastError: error,
                ...(!previous.hasClient && {
                  state: "degraded" as const,
                }),
              },
            ]);
            if (!after.hasClient) {
              yield* closeWatcherScopes;
              yield* publish({ _tag: "degraded", error });
            }
            return;
          }
          yield* rebindWatchers();
          const currentState = yield* Ref.get(state);
          yield* publish({
            _tag: "changed",
            ...(currentState.readMode && {
              readMode: currentState.readMode,
            }),
          });
          yield* logInfo("Opened Zotero database", {
            sourcePath: databasePath,
            readMode: currentState.readMode,
          });
        },
        Effect.ensuring(Deferred.succeed(firstSettled, undefined)),
      );

      const refreshLane: (
        skipUnchanged: boolean,
        done: Deferred.Deferred<void, DbUnavailable>,
      ) => Effect.Effect<void> = Effect.fnUntraced(
        function* (
          skipUnchanged: boolean,
          done: Deferred.Deferred<void, DbUnavailable>,
        ) {
          yield* publish({ _tag: "refreshing", active: true });
          let canSkipUnchanged = skipUnchanged;
          do {
            yield* SynchronizedRef.update(lane, (current) => ({
              ...current,
              again: false,
            }));
            yield* refreshOnce(canSkipUnchanged);
            // A request during an active refresh always gets its trailing read.
            canSkipUnchanged = false;
            if ((yield* SynchronizedRef.get(lane)).again)
              yield* logDebug("Trailing request queued, rerunning refresh");
          } while ((yield* SynchronizedRef.get(lane)).again);
          yield* SynchronizedRef.modify(lane, (current) => {
            if (current.done !== done) return [false, current] as const;
            const failure = current.failure;
            Deferred.doneUnsafe(
              done,
              failure ? Exit.fail(failure) : Exit.succeed(undefined),
            );
            return [
              current.again,
              {
                done: null,
                again: false,
                failure: null,
              },
            ] as const;
          }).pipe(
            Effect.flatMap((trailing) =>
              trailing ? makeAndStartRefreshLane(false) : Effect.void,
            ),
          );
        },
        Effect.ensuring(publish({ _tag: "refreshing", active: false })),
      );

      const makeAndStartRefreshLane: (
        skipUnchanged: boolean,
      ) => Effect.Effect<void> = Effect.fnUntraced(function* (
        skipUnchanged: boolean,
      ) {
        const done = yield* Deferred.make<void, DbUnavailable>();
        const current: Deferred.Deferred<void, DbUnavailable> | null =
          yield* SynchronizedRef.modify(lane, (state) =>
            state.done
              ? ([null, state] as const)
              : ([
                  done,
                  {
                    ...state,
                    done,
                  },
                ] as const),
          );
        if (current)
          yield* refreshLane(skipUnchanged, done).pipe(
            Effect.forkIn(lifetime, { startImmediately: true }),
          );
      });

      /**
       * Single-flight refresh lane with trailing-rerun coalescing: every
       * trigger shares one in-flight run, and a trigger mid-run sets one
       * trailing rerun. Returns the run's completion.
       */
      const enqueueRefresh = ({
        skipUnchanged = false,
      }: { skipUnchanged?: boolean } = {}): Effect.Effect<
        Deferred.Deferred<void, DbUnavailable>
      > =>
        Effect.gen(function* () {
          const done = yield* Deferred.make<void, DbUnavailable>();
          const started: Deferred.Deferred<void, DbUnavailable> =
            yield* SynchronizedRef.modify(lane, (current) =>
              current.done
                ? ([current.done, { ...current, again: true }] as const)
                : ([done, { ...current, done }] as const),
            );
          if (started === done)
            yield* refreshLane(skipUnchanged, done).pipe(
              Effect.forkIn(lifetime, { startImmediately: true }),
            );
          else yield* logDebug("Refresh in flight, coalescing trailing rerun");
          return started;
        });

      // --- Watching ---------------------------------------------------------

      const closeWalWatcher = Effect.gen(function* () {
        const scope = yield* Ref.getAndSet(walWatcherScope, null);
        if (scope) yield* Scope.close(scope, Exit.void);
      });

      /**
       * Fails open: with no fingerprint to compare against, or when the
       * source cannot be read, refresh anyway.
       */
      const sourceMoved = Effect.gen(function* () {
        const before = yield* Ref.get(state);
        const previous = before.fingerprint;
        const path = before.config?.databasePath;
        const currentFingerprint = path ? yield* trySnapshotSource(path) : null;
        const moved =
          !previous ||
          !currentFingerprint ||
          !sourceFingerprintsEqual(previous, currentFingerprint);
        yield* logDebug("Watcher source fingerprint checked", {
          verdict: moved ? "changed" : "unchanged",
          readMode: (yield* Ref.get(state)).readMode,
          previousWalSize: walGenerationSize(previous?.wal),
          currentWalSize: walGenerationSize(currentFingerprint?.wal),
        });
        return moved;
      });

      const refreshIfSourceMoved = Effect.fnUntraced(function* ({
        trusted,
      }: WatchSignal) {
        if (!trusted) {
          const moved = yield* sourceMoved;
          const current = yield* Ref.get(state);
          if (current.readMode !== "immutable" && !moved) {
            yield* logDebug(
              "Watcher tick ignored, database unchanged since last read",
            );
            return;
          }
        }
        // Rechecked after the gate's fingerprint read: the timer cleared before
        // it, so switching auto-refresh off could no longer cancel it.
        if (!trusted && !(yield* Ref.get(state)).config?.autoRefresh) {
          yield* logDebug("Watcher tick ignored, auto-refresh switched off");
          return;
        }
        yield* enqueueRefresh({ skipUnchanged: trusted });
      });

      /**
       * Debounce a change signal, then refresh only if the source really
       * moved. Reading the database clones it, and on APFS a clone raises a
       * `change` event against the source, so a tick proves nothing on its
       * own; the gate holds it against the last read. One trusted signal in a
       * burst sends the whole burst through the refresh lane's comparison.
       */
      const scheduleWatchedRefresh = Effect.fnUntraced(function* ({
        trusted,
        filename,
      }: WatchSignal) {
        if (filename === ZOTERO_WAL_FILENAME) yield* syncWalWatcher();
        if (trusted) yield* Ref.set(watchTrusted, true);
        const readMode = (yield* Ref.get(state)).readMode;
        const debounceMs =
          readMode === "immutable"
            ? IMMUTABLE_WATCH_DEBOUNCE_MS
            : WATCH_DEBOUNCE_MS;
        const timer = yield* Effect.andThen(
          Effect.sleep(Duration.millis(debounceMs)),
          Ref.getAndSet(watchTrusted, false).pipe(
            Effect.flatMap((wasTrusted) =>
              refreshIfSourceMoved({ trusted: wasTrusted }),
            ),
          ),
        ).pipe(Effect.forkIn(lifetime));
        const previous = yield* Ref.getAndSet(watchTimer, timer);
        if (previous) yield* Fiber.interrupt(previous);
      });

      const watchedFilename = (name: string | undefined): boolean => {
        if (name === ZOTERO_DB_FILENAME) return true;
        // Immutable reads ignore the live WAL, so WAL churn can't change what
        // we'd read; only the main DB file is worth watching in that mode.
        return (
          Ref.getUnsafe(state).readMode !== "immutable" &&
          name === ZOTERO_WAL_FILENAME
        );
      };

      const syncWalWatcher = Effect.fnUntraced(function* () {
        const current = yield* Ref.get(state);
        if (!current.sourcePath || current.readMode === "immutable") {
          yield* closeWalWatcher;
          return;
        }
        const walPath = join(dirname(current.sourcePath), ZOTERO_WAL_FILENAME);
        // boundary: the source port owns the synchronous existsSync check.
        if (!(yield* Effect.sync(() => ports.existsSync(walPath)))) {
          yield* closeWalWatcher;
          return;
        }
        if (yield* Ref.get(walWatcherScope)) return;
        const scope = yield* Scope.make();
        const result = yield* Effect.result(
          Effect.acquireRelease(
            // boundary: fs.watch is an external callback API.
            Effect.try({
              try: () =>
                ports.watch(walPath, WATCH_OPTIONS, () =>
                  enqueueWatchSignal({ trusted: false }),
                ),
              catch: (error) => error,
            }),
            (watcher) => Effect.sync(() => watcher.close()),
          ).pipe(Scope.provide(scope)),
        );
        if (result._tag === "Failure") {
          yield* Scope.close(scope, Exit.void);
          yield* logWarningCause("Failed to watch Zotero WAL", result.failure, {
            walPath,
          });
          return;
        }
        yield* Ref.set(walWatcherScope, scope);
      });

      const enqueueWatchSignal = (signal: WatchSignal): void => {
        // boundary: fs.watch invokes listeners synchronously; bridge into Effect once.
        Queue.offerUnsafe(watchSignals, signal);
      };

      const acquireMainWatchers = Effect.fnUntraced(function* (current: {
        sourcePath: string;
        readMode: EffectiveReadMode;
      }) {
        const parent = dirname(current.sourcePath);
        const scope = yield* Scope.make();
        const result = yield* Effect.result(
          Effect.gen(function* () {
            yield* Effect.acquireRelease(
              // boundary: fs.watch is an external callback API.
              Effect.try({
                try: () =>
                  ports.watch(parent, WATCH_OPTIONS, (_event, filename) => {
                    const name = filename?.toString();
                    if (!watchedFilename(name)) return;
                    enqueueWatchSignal({
                      trusted: false,
                      ...(name === ZOTERO_WAL_FILENAME && { filename: name }),
                    });
                  }),
                catch: (error) => error,
              }),
              (watcher) => Effect.sync(() => watcher.close()),
            );
            yield* Effect.acquireRelease(
              // boundary: fs.watch is an external callback API.
              Effect.try({
                try: () =>
                  ports.watch(current.sourcePath, WATCH_OPTIONS, () =>
                    enqueueWatchSignal({ trusted: false }),
                  ),
                catch: (error) => error,
              }),
              (watcher) => Effect.sync(() => watcher.close()),
            );
          }).pipe(Scope.provide(scope)),
        );
        if (result._tag === "Failure") {
          yield* Scope.close(scope, Exit.void);
          yield* logWarningCause(
            "Failed to watch the Zotero database",
            result.failure,
          );
          return null;
        }
        return scope;
      });

      const rebindWatchers = Effect.fnUntraced(function* () {
        yield* closeWatcherScopes;
        const current = yield* Ref.get(state);
        if (!current.config?.autoRefresh) {
          if (!(yield* Ref.get(watchTrusted))) yield* cancelWatchTimer;
          return;
        }
        if (!current.sourcePath || !current.readMode) return;
        const scope = yield* acquireMainWatchers({
          sourcePath: current.sourcePath,
          readMode: current.readMode,
        });
        if (scope) yield* Ref.set(mainWatcherScope, scope);
        yield* syncWalWatcher();
      });

      yield* Stream.fromQueue(watchSignals).pipe(
        Stream.runForEach(scheduleWatchedRefresh),
        Effect.forkIn(lifetime, { startImmediately: true }),
      );

      // --- Configuration ----------------------------------------------------

      const configure = Effect.fnUntraced(function* (next: ReadsConfig) {
        const previous = yield* Ref.modify(state, (current) => [
          current.config,
          { ...current, config: next },
        ]);
        if (!previous) {
          yield* enqueueRefresh();
          return;
        }
        if (next.autoRefresh !== previous.autoRefresh) {
          yield* logDebug("Auto-refresh setting changed", {
            next: next.autoRefresh,
          });
          yield* rebindWatchers();
        }
        if (
          next.databasePath !== previous.databasePath ||
          next.readMode !== previous.readMode
        ) {
          yield* logDebug("Database source changed", {
            databasePath: next.databasePath,
            readMode: next.readMode,
          });
          yield* enqueueRefresh();
        }
      });

      if (options?.initial) yield* configure(options.initial);

      return Connection.of({
        // A read before the first open waits for it, as callers once waited on
        // the service's `ready`.
        borrow: Effect.andThen(Deferred.await(firstSettled), clients.borrow),
        changes,
        // Fails when the lane's last refresh failed, also when the previous
        // client keeps serving; `Changes` tells the two apart.
        refresh: Effect.flatMap(enqueueRefresh(), Deferred.await),
        notifyExternalChange: Effect.gen(function* () {
          yield* logDebug("External change signalled, scheduling refresh");
          yield* scheduleWatchedRefresh({ trusted: true });
        }),
        configure,
        databaseGeneration: databaseGenerations.databaseGeneration,
        databaseFile: databaseGenerations.databaseFile,
      });
    }),
  );
}
