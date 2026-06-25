import { serve, type ServerType } from "@hono/node-server";
import { vValidator } from "@hono/valibot-validator";
import { type Context, type Next } from "hono";
import { Hono } from "hono/tiny";

import {
  batchUpdateRequestSchema,
  type NotifyEvent,
  notifyEventSchema,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
  type ReaderActive,
  type ReaderAnnotSelect,
  type ItemUpdate,
  type UpdateScope,
} from "@zotlit/protocol";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { getLogger } from "@/lib/log";
import { rejectIncompatibleProtocol } from "@/services/protocol/compat";
import { Service } from "@/services/service-base";
import {
  type Settings,
  type SettingsService,
} from "@/services/settings/service";
import { type ZoteroPrefService } from "@/services/zotero-pref/service";

const logger = getLogger("live-update");

/** Sender's raw profile/data dirs, present only when its debug logging is on. */
function senderDirs(event: NotifyEvent): Record<string, string> {
  const out: Record<string, string> = {};
  if (event.profilePath !== undefined) out.profilePath = event.profilePath;
  if (event.dataPath !== undefined) out.dataPath = event.dataPath;
  return out;
}

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
  "item/update": (event: ItemUpdate) => void;
  /**
   * A batch literature-note update requested over `PATCH /literature-notes` —
   * the companion's fallback when the id list is too long for an `obsidian://`
   * URL. Carries the raw item ids; the subscriber owns resolution and the modal.
   */
  "update-many": (event: { items: number[]; scope: UpdateScope }) => void;
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
      case "item/update":
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
    const app = new Hono();
    app
      /** Reject a request whose `X-Zotlit-Protocol-Version` header is incompatible. */
      .use(async (c: Context, next: Next): Promise<Response | void> => {
        if (
          rejectIncompatibleProtocol(
            c.req.header(PROTOCOL_VERSION_HEADER),
            logger,
            { transport: "http" },
          )
        ) {
          return c.body(null, 204);
        }
        await next();
      })
      /** Discard a request whose `X-Zotlit-Source-Id` isn't the configured install. */
      .use(async (c: Context, next: Next): Promise<Response | void> => {
        const expected = this.#zoteroPref.sourceId;
        const received = c.req.header(SOURCE_ID_HEADER);
        if (expected === null || received !== expected) {
          logger.warn("Discarded request: source id mismatch", {
            expected,
            received,
          });
          return c.body(null, 204);
        }
        await next();
      })
      .post(
        "/notify",
        vValidator("json", notifyEventSchema, (result, c) => {
          if (result.success) return;
          logger.warn("Received notify event failed validation", {
            issues: result.issues,
          });
          return c.json(result, 400);
        }),
        (c) => {
          const event = c.req.valid("json");
          logger.debug("Received notify event", {
            event: event.event,
            ...senderDirs(event),
          });
          this.#dispatch(event);
          return c.body(null, 204);
        },
      )
      // Fire-and-forget: the batch modal is interactive and long-running, so ack
      // 204 immediately and let the subscriber drive it; never await the batch.
      .patch(
        "/literature-notes",
        vValidator("json", batchUpdateRequestSchema, (result, c) => {
          if (result.success) return;
          logger.warn("Received literature-notes update failed validation", {
            issues: result.issues,
          });
          return c.json(result, 400);
        }),
        (c) => {
          const body = c.req.valid("json");
          logger.debug("Received literature-notes update", {
            items: body.items.length,
            scope: body.scope,
          });
          // decouple from the event loop to avoid handler
          // from blocking the main thread and let response finish first.
          void sleep(0).then(() => {
            this.#emitter.emit("update-many", {
              items: body.items,
              scope: body.scope,
            });
          });
          return c.body(null, 204);
        },
      );

    const server = serve(
      { fetch: app.fetch, port: this.#port, hostname: this.#hostname },
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
