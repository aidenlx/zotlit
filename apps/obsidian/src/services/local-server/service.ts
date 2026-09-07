import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import type { Env } from "hono";
import { Hono } from "hono/tiny";

import type {
  DbUpdated,
  ImportMode,
  NotifyEvent,
  ReaderActive,
  ReaderAnnotSelect,
  UpdateScope,
} from "@zotlit/protocol";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { getLogger } from "@/lib/log";
import type { NoteIndex } from "@/services/note-index/service";
import { Service } from "@/services/service-base";
import type { Settings, SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";

import { createLiveUpdateApp } from "./live-update-app";

const logger = getLogger("local-server");

/**
 * How many consecutive ports the listener tries, starting at the configured
 * one. A second vault on the same port setting takes the next free port.
 */
const PORT_RANGE = 10;

const MAX_PORT = 65535;

/** Outcome of one bind attempt: the listener, a busy port, or a dead end. */
type BindResult = ServerType | "in-use" | "failed";

/**
 * Live state of the Zotero reader, derived from the companion's reader pushes.
 * The service is the authoritative holder; views sync from {@link
 * LocalServerService.readerTarget} on mount and the reader events thereafter.
 */
export interface ReaderTarget {
  /** Parent (regular) item the open attachment belongs to. */
  itemID: number;
  /** The open attachment item. */
  attachmentID: number;
  /** Item IDs of the annotations currently selected in the reader. */
  selected: readonly number[];
}

export interface LocalServerEvents {
  /**
   * The companion's Freshness Signal: the Zotero database changed and the
   * main database file is as current as the companion can make it.
   * Payload-free by design — subscribers treat it as a refresh trigger,
   * never as data.
   */
  "db/updated": (event: DbUpdated) => void;
  /**
   * A batch literature-note update requested over `PUT /literature-notes` —
   * the companion's fallback when the id list is too long for an `obsidian://`
   * URL. Carries the raw item ids; the subscriber owns resolution and the modal.
   */
  "update-many": (event: {
    items: number[];
    scope: UpdateScope;
    profileId?: string;
  }) => void;
  /**
   * A batch note-import requested over `PUT /zotero-notes` — the companion's
   * fallback when the id list is too long for an `obsidian://` URL.
   */
  "import-notes": (event: { items: number[]; mode: ImportMode }) => void;
  /**
   * Aggregated reader state: fired whenever the companion reports a reader
   * switch or a selection change, carrying the new {@link ReaderTarget}.
   * Consumers diff `attachmentID` to tell a document switch from a re-select.
   */
  "reader/target": (target: ReaderTarget) => void;
  /**
   * Edge transitions of {@link LocalServerService.available} — fired when the
   * listener starts answering Live Update or stops (either toggle off, a port
   * rebind, or a bind error). Consumers gate reader-follow features on this.
   */
  available: (available: boolean) => void;
  /**
   * The port the listener is bound to, or `null` once it stops. Fired on every
   * bind and every close, so a settings row can show the effective port
   * without polling.
   */
  listening: (port: number | null) => void;
}

export interface LocalServerServiceDeps {
  settings: SettingsService;
  zoteroPref: ZoteroPrefService;
  noteIndex: NoteIndex;
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
export class LocalServerService extends Service<void> {
  readonly #settings;
  readonly #zoteroPref;
  readonly #noteIndex;
  readonly #emitter = createNanoEvents<LocalServerEvents>();
  /** The one Hono app every hosted service's routes are mounted on. */
  readonly #app = new Hono();

  #server: ServerType | null = null;
  #chain: Promise<void> = Promise.resolve();

  #enabled = false;
  #liveUpdateEnabled = false;
  #port = 0;
  #hostname = "";
  #boundPort: number | null = null;
  #available = false;
  #readerTarget: ReaderTarget | null = null;

  ready: Promise<void>;

  constructor(deps: LocalServerServiceDeps) {
    super();
    this.#settings = deps.settings;
    this.#zoteroPref = deps.zoteroPref;
    this.#noteIndex = deps.noteIndex;
    this.#app.route(
      "/",
      createLiveUpdateApp({
        enabled: () => this.#liveUpdateEnabled,
        sourceId: () => this.#zoteroPref.sourceId,
        noteIndex: this.#noteIndex,
        onNotify: (event) => this.#dispatch(event),
        onUpdateMany: (event) => this.#emitter.emit("update-many", event),
        onImportNotes: (event) => this.#emitter.emit("import-notes", event),
      }),
    );
    this.ready = this.#load();
  }

  /** `true` only while Live Update is on and the listener accepts connections. */
  get available(): boolean {
    return this.#available;
  }

  /**
   * The port the listener is bound to, or `null` while it is down. It differs
   * from the `server.port` setting when that port was busy — see
   * {@link PORT_RANGE}.
   */
  get effectivePort(): number | null {
    return this.#boundPort;
  }

  /**
   * Mounts a hosted service's routes on the Local Server's one Hono app, under
   * `basePath`. Routes stay mounted for the plugin's lifetime; the hosted
   * service gates its own routes on its own toggle. Safe to call while the
   * listener runs — mounted routes answer the next request.
   */
  mount<E extends Env>(basePath: string, routes: Hono<E>): void {
    this.#app.route(basePath, routes);
  }

  /** Latest reader state pushed by the companion; `null` until the first push. */
  get readerTarget(): ReaderTarget | null {
    return this.#readerTarget;
  }

  on<K extends keyof LocalServerEvents>(
    event: K,
    cb: LocalServerEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  /** Recompute {@link available} from the toggles and the bind, emitting on change. */
  #refreshAvailability(): void {
    const next =
      this.#enabled && this.#liveUpdateEnabled && this.#boundPort !== null;
    if (next === this.#available) return;
    this.#available = next;
    // The held reader state is only valid while the companion can reach us.
    if (!next) this.#readerTarget = null;
    logger.debug("Server availability changed", { available: next });
    this.#emitter.emit("available", next);
  }

  /** Fan a parsed notify event out to its typed channel. */
  #dispatch(event: NotifyEvent): void {
    switch (event.event) {
      case "db/updated":
        this.#emitter.emit(event.event, event);
        break;
      case "reader/annot-select":
      case "reader/active":
        this.#emitter.emit("reader/target", this.#trackReader(event));
        break;
    }
  }

  /** Refresh the authoritative reader target from a reader push. */
  #trackReader(event: ReaderActive | ReaderAnnotSelect): ReaderTarget {
    const target: ReaderTarget = {
      itemID: event.itemID,
      attachmentID: event.attachmentID,
      selected: event.selected,
    };
    this.#readerTarget = target;
    return target;
  }

  async #load(): Promise<void> {
    const settings = await this.#settings.loaded;
    await using stack = new AsyncDisposableStack();

    this.#enabled = settings["server.enabled"];
    this.#liveUpdateEnabled = settings["server.live-update"];
    this.#port = settings["server.port"];
    this.#hostname = settings["server.hostname"];

    // The stack unwinds last-registered-first, so the subscription goes last:
    // a settings emit arriving after the listener closed would otherwise
    // rebind a port on a disposed service.
    stack.defer(async () => {
      await this.#chain;
      await this.#stopServer();
    });
    stack.defer(
      this.#settings.subscribe((value) => {
        if (value) this.#onSettingsChanged(value);
      }),
    );

    this.#reconcile();
    this.commit(stack.move());
  }

  #onSettingsChanged(settings: Readonly<Settings>): void {
    const enabled = settings["server.enabled"];
    const liveUpdate = settings["server.live-update"];
    const port = settings["server.port"];
    const hostname = settings["server.hostname"];
    const rebind =
      enabled !== this.#enabled ||
      port !== this.#port ||
      hostname !== this.#hostname;
    if (!rebind && liveUpdate === this.#liveUpdateEnabled) return;
    this.#enabled = enabled;
    this.#liveUpdateEnabled = liveUpdate;
    this.#port = port;
    this.#hostname = hostname;
    // The Live updates toggle gates its own routes, so flipping it alone
    // leaves the listener where it is — the Workbench keeps its port.
    if (rebind) this.#reconcile();
    else this.#refreshAvailability();
  }

  /** Serialize start/stop so the latest desired state always wins cleanly. */
  #reconcile(): void {
    this.#chain = this.#chain
      .then(async () => {
        await this.#stopServer();
        if (this.#enabled) await this.#startServer();
      })
      .catch((error) => {
        logger.error("Failed to reconcile server", { error });
      });
  }

  /**
   * Binds the first free port in the range that starts at the configured one,
   * so a second vault sharing the setting still gets a listener.
   */
  async #startServer(): Promise<void> {
    for (let offset = 0; offset < PORT_RANGE; offset++) {
      const port = this.#port + offset;
      if (port > MAX_PORT) break;
      const result = await this.#listen(port);
      // A port held by someone else is the case the range exists for; any
      // other bind failure repeats on every port, so stop after the first.
      if (result === "in-use") continue;
      if (result === "failed") return;
      this.#server = result;
      this.#boundPort = port;
      this.#refreshAvailability();
      this.#emitter.emit("listening", port);
      return;
    }
    logger.error("No free port for the local server", {
      port: this.#port,
      range: PORT_RANGE,
    });
  }

  /**
   * One bind attempt. Resolves the listening server, `"in-use"` when the port
   * is taken so the caller tries the next one, or `"failed"` when the bind is
   * hopeless — a bad hostname, say, which every port in the range repeats.
   */
  #listen(port: number): Promise<BindResult> {
    return new Promise<BindResult>((resolve) => {
      let bound = false;
      try {
        const server = serve(
          {
            fetch: this.#app.fetch,
            port,
            hostname: this.#hostname,
            // The listener swaps its own `Request`/`Response` classes into the
            // globals unless told otherwise, and those globals belong to the
            // whole Obsidian window. WebAssembly streaming brand-checks the
            // native `Response`, so a swapped-in class stops the Pandoc engine
            // from instantiating. The listener keeps the native classes instead.
            overrideGlobalObjects: false,
          },
          (info) => {
            bound = true;
            logger.info("Server listening", {
              address: info.address,
              port: info.port,
            });
            resolve(server);
          },
        );
        server.on("error", (error: NodeJS.ErrnoException) => {
          if (!bound) {
            bound = true;
            if (error.code === "EADDRINUSE") {
              logger.debug("Port taken, trying the next one", { port });
              resolve("in-use");
            } else {
              logger.error("Failed to bind server", { port, error });
              resolve("failed");
            }
            return;
          }
          // A failure past the bind: the listener is gone, so report it down.
          if (this.#server !== server) return;
          this.#boundPort = null;
          this.#refreshAvailability();
          this.#emitter.emit("listening", null);
          logger.error("Server error", { error });
        });
      } catch (error) {
        // `serve` throws synchronously on an unusable listen option; without
        // this the promise never settles and disposal waits on it forever.
        logger.error("Failed to start server", { port, error });
        resolve("failed");
      }
    });
  }

  async #stopServer(): Promise<void> {
    const server = this.#server;
    const wasBound = this.#boundPort !== null;
    this.#server = null;
    this.#boundPort = null;
    this.#refreshAvailability();
    if (wasBound) this.#emitter.emit("listening", null);
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    logger.info("Server stopped");
  }
}
