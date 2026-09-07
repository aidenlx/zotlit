import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";

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

import { createLiveUpdateApp } from "./app";

const logger = getLogger("live-update");

/**
 * Live state of the Zotero reader, derived from the companion's reader pushes.
 * The service is the authoritative holder; views sync from {@link
 * LiveUpdateService.readerTarget} on mount and the reader events thereafter.
 */
export interface ReaderTarget {
  /** Parent (regular) item the open attachment belongs to. */
  itemID: number;
  /** The open attachment item. */
  attachmentID: number;
  /** Item IDs of the annotations currently selected in the reader. */
  selected: readonly number[];
}

export interface LiveUpdateEvents {
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
   * Edge transitions of {@link LiveUpdateService.available} — fired when the
   * listener starts accepting connections or stops (settings off, port rebind,
   * or a bind error). Consumers gate reader-follow features on this.
   */
  available: (available: boolean) => void;
}

export interface LiveUpdateServiceDeps {
  settings: SettingsService;
  zoteroPref: ZoteroPrefService;
  noteIndex: NoteIndex;
}

/**
 * Localhost HTTP listener that receives event pushes from the Zotero companion.
 *
 * Validates `POST /notify` bodies against {@link notifyEventSchema} and
 * re-emits the parsed event on {@link on}. Start/stop and rebinding follow the
 * `server.*` settings; lifecycle transitions are serialized so a port change
 * can't race a half-closed server.
 */
export class LiveUpdateService extends Service<void> {
  readonly #settings;
  readonly #zoteroPref;
  readonly #noteIndex;
  readonly #emitter = createNanoEvents<LiveUpdateEvents>();

  #server: ServerType | null = null;
  #chain: Promise<void> = Promise.resolve();

  #enabled = false;
  #port = 0;
  #hostname = "";
  #listening = false;
  #available = false;
  #readerTarget: ReaderTarget | null = null;

  ready: Promise<void>;

  constructor(deps: LiveUpdateServiceDeps) {
    super();
    this.#settings = deps.settings;
    this.#zoteroPref = deps.zoteroPref;
    this.#noteIndex = deps.noteIndex;
    this.ready = this.#load();
  }

  /** `true` only while the listener is enabled and accepting connections. */
  get available(): boolean {
    return this.#available;
  }

  /** Latest reader state pushed by the companion; `null` until the first push. */
  get readerTarget(): ReaderTarget | null {
    return this.#readerTarget;
  }

  on<K extends keyof LiveUpdateEvents>(
    event: K,
    cb: LiveUpdateEvents[K],
  ): () => void {
    return this.#emitter.on(event, cb);
  }

  /** Recompute {@link available} from enabled+listening, emitting on change. */
  #refreshAvailability(): void {
    const next = this.#enabled && this.#listening;
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
    this.#port = settings["server.port"];
    this.#hostname = settings["server.hostname"];

    stack.defer(
      this.#settings.subscribe((value) => {
        if (value) this.#onSettingsChanged(value);
      }),
    );
    stack.defer(async () => {
      await this.#chain;
      await this.#stopServer();
    });

    this.#reconcile();
    this.commit(stack.move());
  }

  #onSettingsChanged(settings: Readonly<Settings>): void {
    const enabled = settings["server.enabled"];
    const port = settings["server.port"];
    const hostname = settings["server.hostname"];
    if (
      enabled === this.#enabled &&
      port === this.#port &&
      hostname === this.#hostname
    ) {
      return;
    }
    this.#enabled = enabled;
    this.#port = port;
    this.#hostname = hostname;
    this.#reconcile();
  }

  /** Serialize start/stop so the latest desired state always wins cleanly. */
  #reconcile(): void {
    this.#chain = this.#chain
      .then(async () => {
        await this.#stopServer();
        if (this.#enabled) this.#startServer();
      })
      .catch((error) => {
        logger.error("Failed to reconcile server", { error });
      });
  }

  #startServer(): void {
    const app = createLiveUpdateApp({
      sourceId: () => this.#zoteroPref.sourceId,
      noteIndex: this.#noteIndex,
      onNotify: (event) => this.#dispatch(event),
      onUpdateMany: (event) => this.#emitter.emit("update-many", event),
      onImportNotes: (event) => this.#emitter.emit("import-notes", event),
    });

    const server = serve(
      {
        fetch: app.fetch,
        port: this.#port,
        hostname: this.#hostname,
        // The listener swaps its own `Request`/`Response` classes into the
        // globals unless told otherwise, and those globals belong to the whole
        // Obsidian window. WebAssembly streaming brand-checks the native
        // `Response`, so a swapped-in class stops the Pandoc engine from
        // instantiating. The listener keeps the native classes instead.
        overrideGlobalObjects: false,
      },
      (info) => {
        this.#listening = true;
        this.#refreshAvailability();
        logger.info("Server listening", {
          address: info.address,
          port: info.port,
        });
      },
    );
    server.on("error", (error) => {
      this.#listening = false;
      this.#refreshAvailability();
      logger.error("Server error", { error });
    });
    this.#server = server;
  }

  async #stopServer(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#listening = false;
    this.#refreshAvailability();
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    logger.info("Server stopped");
  }
}
