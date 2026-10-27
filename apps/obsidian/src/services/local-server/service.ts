import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import {
  Cause,
  Context,
  Effect,
  Layer,
  PubSub,
  Stream,
  SubscriptionRef,
} from "effect";
import type { Env } from "hono";
import { Hono } from "hono/tiny";

import type {
  DbUpdated,
  ImportMode,
  NotifyEvent,
  UpdateScope,
} from "@zotlit/protocol";

import { scopedBridge, valueOr } from "@/lib/effect-bridge";
import { withLogCategory } from "@/lib/effect-log";
import { forkEach } from "@/lib/effect-stream";
import { NoteIndex } from "@/services/note-index/service";
import { PluginSettings } from "@/services/settings/service";
import type { Settings } from "@/services/settings/service";
import { ZoteroPref } from "@/services/zotero-pref/service";

import { createLiveUpdateApp } from "./live-update-app";
import type { NoteStatusSource } from "./live-update-app";

/**
 * How many consecutive ports the listener tries, starting at the configured
 * one. A second vault on the same port setting takes the next free port.
 */
const PORT_RANGE = 10;

const MAX_PORT = 65535;

/** Outcome of one bind attempt: the listener, a busy port, or a dead end. */
type BindResult = { server: ServerType; port: number } | "in-use" | "failed";

/**
 * Live state of the Zotero reader, derived from the companion's reader pushes.
 * The service is the authoritative holder; views sync from {@link
 * LocalServer.readerTarget} on mount and {@link LocalServer.readerTargetChanges}
 * thereafter.
 */
export interface ReaderTarget {
  /** Parent (regular) item the open attachment belongs to. */
  itemID: number;
  /** The open attachment item. */
  attachmentID: number;
  /** Item IDs of the annotations currently selected in the reader. */
  selected: readonly number[];
}

export interface UpdateManyRequest {
  readonly items: number[];
  readonly scope: UpdateScope;
  readonly profileId?: string;
}

export interface ImportNotesRequest {
  readonly items: number[];
  readonly mode: ImportMode;
}

/**
 * The plugin's one loopback HTTP listener on this desktop — the Local Server.
 *
 * It owns a single Hono app and a single `serve` call. Live Update's routes
 * are mounted on it at construction; another hosted service mounts its own
 * route group through {@link mount}. Each hosted service answers only while
 * its own toggle is on, so the listener's own toggle is what opens the port.
 *
 * Start/stop and rebinding follow the `server.*` settings; lifecycle
 * transitions are serialized so a port change can't race a half-closed server.
 */
export class LocalServer extends Context.Service<
  LocalServer,
  {
    /** `true` only while Live Update is on and the listener accepts connections. */
    readonly available: Effect.Effect<boolean>;
    /**
     * Edge transitions of {@link available} — fired when the listener starts
     * answering Live Update or stops (either toggle off, a port rebind, or a
     * bind error). Consumers gate reader-follow features on this.
     */
    readonly availableChanges: Stream.Stream<boolean>;
    /**
     * The port the listener is bound to, or `null` while it is down. It differs
     * from the `server.port` setting when that port was busy — see
     * {@link PORT_RANGE}.
     */
    readonly effectivePort: Effect.Effect<number | null>;
    /**
     * The port the listener is bound to, or `null` once it stops. Fires on
     * every bind and every close, so a settings row can show the effective port
     * without polling.
     */
    readonly effectivePortChanges: Stream.Stream<number | null>;
    /**
     * Latest reader state pushed by the companion; `null` until the first push.
     * It is held past a closed reader and past a listener that stopped
     * answering, so a surface following the Zotero reader keeps the attachment
     * it last had open rather than emptying.
     */
    readonly readerTarget: Effect.Effect<ReaderTarget | null>;
    /**
     * Aggregated reader state: emitted whenever the companion reports a reader
     * switch or a selection change, carrying the new {@link ReaderTarget}.
     * Consumers diff `attachmentID` to tell a document switch from a re-select.
     */
    readonly readerTargetChanges: Stream.Stream<ReaderTarget | null>;
    /**
     * `true` while the companion's last word was that the focused Zotero tab or
     * window is no longer a reader. {@link readerTarget} still names the
     * attachment that reader had open.
     */
    readonly readerClosed: Effect.Effect<boolean>;
    /**
     * Edge transitions of {@link readerClosed}: `true` once the companion
     * reports that the focused Zotero tab or window is no longer a reader,
     * `false` again on the next reader push. The held {@link readerTarget}
     * stays put either way, so a surface can keep the last attachment on
     * screen and say that the reader closed.
     */
    readonly readerClosedChanges: Stream.Stream<boolean>;
    /**
     * The companion's Freshness Signal: the Zotero database changed and the
     * main database file is as current as the companion can make it.
     * Payload-free by design — subscribers treat it as a refresh trigger,
     * never as data.
     */
    readonly dbUpdated: Stream.Stream<DbUpdated>;
    /**
     * A batch literature-note update requested over `PUT /literature-notes` —
     * the companion's fallback when the id list is too long for an `obsidian://`
     * URL. Carries the raw item ids; the subscriber owns resolution and the
     * modal.
     */
    readonly updateManyRequests: Stream.Stream<UpdateManyRequest>;
    /**
     * A batch note-import requested over `PUT /zotero-notes` — the companion's
     * fallback when the id list is too long for an `obsidian://` URL.
     */
    readonly importNotesRequests: Stream.Stream<ImportNotesRequest>;
    /**
     * Mounts a hosted service's routes on the Local Server's one Hono app,
     * under `basePath`. Routes stay mounted for the plugin's lifetime; the
     * hosted service gates its own routes on its own toggle. Safe to call while
     * the listener runs — mounted routes answer the next request.
     */
    mount<E extends Env>(
      basePath: string,
      routes: Hono<E>,
    ): Effect.Effect<void>;
  }
>()("zotlit/local-server/LocalServer") {}

export const layerLocalServer: Layer.Layer<
  LocalServer,
  never,
  PluginSettings | ZoteroPref | NoteIndex
> = Layer.effect(
  LocalServer,
  Effect.gen(function* () {
    const settings = yield* PluginSettings;
    const zoteroPref = yield* ZoteroPref;
    const noteIndex = yield* NoteIndex;

    // Node callbacks and Hono handlers run outside Effect.
    const { runSync: run, runPromiseExit } = yield* scopedBridge;

    const available = yield* SubscriptionRef.make(false);
    const boundPort = yield* SubscriptionRef.make<number | null>(null);
    const readerTarget = yield* SubscriptionRef.make<ReaderTarget | null>(null);
    const readerClosed = yield* SubscriptionRef.make(false);

    const dbUpdated = yield* PubSub.unbounded<DbUpdated>();
    const updateMany = yield* PubSub.unbounded<UpdateManyRequest>();
    const importNotes = yield* PubSub.unbounded<ImportNotesRequest>();

    let server: ServerType | null = null;
    let enabled = false;
    let liveUpdateEnabled = false;
    let port = -1;
    let hostname = "";
    let stoppedFlag = false;
    const app = new Hono();

    /** Recompute availability from the toggles and the bind. */
    const refreshAvailability = Effect.fn("LocalServer.refreshAvailability")(
      function* () {
        const next =
          enabled &&
          liveUpdateEnabled &&
          (yield* SubscriptionRef.get(boundPort)) !== null;
        if (next === (yield* SubscriptionRef.get(available))) return;
        yield* SubscriptionRef.set(available, next);
        yield* Effect.logDebug("Server availability changed").pipe(
          Effect.annotateLogs({ available: next }),
        );
      },
    );

    const setReaderClosed = Effect.fn("LocalServer.setReaderClosed")(function* (
      closed: boolean,
    ) {
      if (closed === (yield* SubscriptionRef.get(readerClosed))) return;
      yield* SubscriptionRef.set(readerClosed, closed);
      yield* Effect.logDebug("Zotero reader presence changed").pipe(
        Effect.annotateLogs({ closed }),
      );
    });

    /** Fan a parsed notify event out to its typed channel. */
    function dispatch(event: NotifyEvent): void {
      switch (event.event) {
        case "db/updated":
          PubSub.publishUnsafe(dbUpdated, event);
          break;
        case "reader/annot-select":
        case "reader/active": {
          const target: ReaderTarget = {
            itemID: event.itemID,
            attachmentID: event.attachmentID,
            selected: event.selected,
          };
          run(SubscriptionRef.set(readerTarget, target));
          run(setReaderClosed(false));
          break;
        }
        case "reader/inactive":
          run(setReaderClosed(true));
          break;
      }
    }

    /**
     * One bind attempt. Resolves the listening server, `"in-use"` when the port
     * is taken so the caller tries the next one, or `"failed"` when the bind is
     * hopeless — a bad hostname, say, which every port in the range repeats.
     */
    const listen = (port: number): Effect.Effect<BindResult> =>
      Effect.callback<BindResult>((resume) => {
        let bound = false;
        try {
          const listener = serve(
            {
              fetch: app.fetch,
              port,
              hostname,
              // The listener swaps its own `Request`/`Response` classes into
              // the globals unless told otherwise, and those globals belong to
              // the whole Obsidian window. WebAssembly streaming brand-checks
              // the native `Response`, so a swapped-in class stops the Pandoc
              // engine from instantiating. The listener keeps the native
              // classes instead.
              overrideGlobalObjects: false,
            },
            (info) => {
              bound = true;
              run(
                Effect.logInfo("Server listening").pipe(
                  Effect.annotateLogs({
                    address: info.address,
                    port: info.port,
                  }),
                ),
              );
              resume(Effect.succeed({ server: listener, port: info.port }));
            },
          );
          listener.on("error", (error: NodeJS.ErrnoException) => {
            if (!bound) {
              bound = true;
              if (error.code === "EADDRINUSE") {
                run(
                  Effect.logDebug("Port taken, trying the next one").pipe(
                    Effect.annotateLogs({ port }),
                  ),
                );
                resume(Effect.succeed("in-use"));
              } else {
                run(
                  Effect.logError("Failed to bind server").pipe(
                    Effect.annotateLogs({ port, error }),
                  ),
                );
                resume(Effect.succeed("failed"));
              }
              return;
            }
            // A failure past the bind: the listener is gone, so report it down.
            if (server !== listener) return;
            run(
              Effect.gen(function* () {
                yield* SubscriptionRef.set(boundPort, null);
                yield* refreshAvailability();
                yield* Effect.logError("Server error").pipe(
                  Effect.annotateLogs({ error }),
                );
              }),
            );
          });
        } catch (error) {
          // `serve` throws synchronously on an unusable listen option; without
          // this the promise never settles and disposal waits on it forever.
          run(
            Effect.logError("Failed to start server").pipe(
              Effect.annotateLogs({ port, error }),
            ),
          );
          resume(Effect.succeed("failed"));
        }
      });

    /**
     * Binds the first free port in the range that starts at the configured one,
     * so a second vault sharing the setting still gets a listener.
     */
    const startServer = Effect.fn("LocalServer.startServer")(function* () {
      for (let offset = 0; offset < PORT_RANGE; offset++) {
        const candidate = port + offset;
        if (candidate > MAX_PORT) break;
        const result = yield* listen(candidate);
        // A port held by someone else is the case the range exists for; any
        // other bind failure repeats on every port, so stop after the first.
        if (result === "in-use") continue;
        if (result === "failed") return;
        server = result.server;
        yield* SubscriptionRef.set(boundPort, result.port);
        yield* refreshAvailability();
        return;
      }
      yield* Effect.logError("No free port for the local server").pipe(
        Effect.annotateLogs({ port, range: PORT_RANGE }),
      );
    });

    const stopServer = Effect.fn("LocalServer.stopServer")(function* () {
      const current = server;
      const wasBound = (yield* SubscriptionRef.get(boundPort)) !== null;
      server = null;
      if (wasBound) yield* SubscriptionRef.set(boundPort, null);
      yield* refreshAvailability();
      if (!current) return;
      yield* Effect.callback<void, Error>((resume) => {
        current.close((error) => {
          resume(error ? Effect.fail(error) : Effect.void);
        });
      });
      yield* Effect.logInfo("Server stopped");
    });

    const reconcile = Effect.gen(function* () {
      yield* stopServer();
      if (enabled) yield* startServer();
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logError("Failed to reconcile server", cause),
      ),
      Effect.uninterruptible,
    );

    const noteStatus: NoteStatusSource = {
      getIndexedItemKeys: () => run(noteIndex.getIndexedItemKeys),
      whenIndexed: async () => {
        if (stoppedFlag) return false;
        return valueOr(
          await runPromiseExit(Effect.as(noteIndex.whenIndexed, true)),
          false,
        );
      },
    };

    app.route(
      "/",
      createLiveUpdateApp({
        enabled: () => liveUpdateEnabled,
        sourceId: () => run(zoteroPref.current).sourceId,
        noteIndex: noteStatus,
        onNotify: dispatch,
        onUpdateMany: (event) => void PubSub.publishUnsafe(updateMany, event),
        onImportNotes: (event) => void PubSub.publishUnsafe(importNotes, event),
      }),
    );

    // This runs after the settings consumer stops: its finalizer registers
    // later, and Scope finalizers run in reverse order.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        stoppedFlag = true;
        yield* stopServer().pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Failed to stop server", cause),
          ),
        );
        yield* PubSub.shutdown(available.pubsub);
        yield* PubSub.shutdown(boundPort.pubsub);
        yield* PubSub.shutdown(readerTarget.pubsub);
        yield* PubSub.shutdown(readerClosed.pubsub);
        yield* PubSub.shutdown(dbUpdated);
        yield* PubSub.shutdown(updateMany);
        yield* PubSub.shutdown(importNotes);
      }),
    );

    const onSettingsChanged = Effect.fn("LocalServer.onSettingsChanged")(
      function* (value: Readonly<Settings>) {
        const nextEnabled = value["server.enabled"];
        const nextLiveUpdate = value["server.live-update"];
        const nextPort = value["server.port"];
        const nextHostname = value["server.hostname"];
        const rebind =
          nextEnabled !== enabled ||
          nextPort !== port ||
          nextHostname !== hostname;
        if (!rebind && nextLiveUpdate === liveUpdateEnabled) return;
        enabled = nextEnabled;
        liveUpdateEnabled = nextLiveUpdate;
        port = nextPort;
        hostname = nextHostname;
        // Live Update's toggle gates its own routes, so flipping it alone
        // leaves the listener where it is — the Workbench keeps its port.
        if (rebind) yield* reconcile;
        else yield* refreshAvailability();
      },
    );

    // Settings replay the current snapshot first. The sentinel port makes that
    // first event rebind, and `forkEach` handles one event at a time so binds
    // never overlap.
    yield* forkEach(settings.changes, (value) => onSettingsChanged(value));

    return LocalServer.of({
      available: SubscriptionRef.get(available),
      availableChanges: SubscriptionRef.changes(available),
      effectivePort: SubscriptionRef.get(boundPort),
      effectivePortChanges: SubscriptionRef.changes(boundPort),
      readerTarget: SubscriptionRef.get(readerTarget),
      readerTargetChanges: SubscriptionRef.changes(readerTarget),
      readerClosed: SubscriptionRef.get(readerClosed),
      readerClosedChanges: SubscriptionRef.changes(readerClosed),
      dbUpdated: Stream.fromPubSub(dbUpdated),
      updateManyRequests: Stream.fromPubSub(updateMany),
      importNotesRequests: Stream.fromPubSub(importNotes),
      mount: Effect.fn("LocalServer.mount")((basePath, routes) =>
        Effect.sync(() => {
          app.route(basePath, routes);
        }),
      ),
    });
  }).pipe(withLogCategory("local-server")),
);
