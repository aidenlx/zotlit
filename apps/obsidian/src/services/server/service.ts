import { serve, type ServerType } from "@hono/node-server";
import { vValidator } from "@hono/valibot-validator";
import { Hono } from "hono/tiny";

import {
  type NotifyEvent,
  notifyEventSchema,
  type ReaderActive,
  type ReaderAnnotSelect,
  type ItemUpdate,
} from "@zotlit/protocol";
import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { getLogger } from "@/lib/log";
import { Service } from "@/services/service-base";
import {
  type Settings,
  type SettingsService,
} from "@/services/settings/service";

const logger = getLogger("server");

export interface ServerEvents {
  "item/update": (event: ItemUpdate) => void;
  "reader/annot-select": (event: ReaderAnnotSelect) => void;
  "reader/active": (event: ReaderActive) => void;
}

export interface ServerServiceDeps {
  settings: SettingsService;
}

/**
 * Localhost HTTP listener that receives event pushes from the Zotero companion.
 *
 * Validates `POST /notify` bodies against {@link notifyEventSchema} and
 * re-emits the parsed event on {@link on}. Start/stop and rebinding follow the
 * `server.*` settings; lifecycle transitions are serialized so a port change
 * can't race a half-closed server.
 */
export class ServerService extends Service<void> {
  readonly #settings;
  readonly #emitter = createNanoEvents<ServerEvents>();

  #server: ServerType | null = null;
  #chain: Promise<void> = Promise.resolve();

  #enabled = false;
  #port = 0;
  #hostname = "";

  ready: Promise<void>;

  constructor(deps: ServerServiceDeps) {
    super();
    this.#settings = deps.settings;
    this.ready = this.#load();
  }

  on<K extends keyof ServerEvents>(event: K, cb: ServerEvents[K]): () => void {
    return this.#emitter.on(event, cb);
  }

  /** Fan a parsed notify event out to its typed channel. */
  #dispatch(event: NotifyEvent): void {
    switch (event.event) {
      case "item/update":
        this.#emitter.emit(event.event, event);
        break;
      case "reader/annot-select":
        this.#emitter.emit(event.event, event);
        break;
      case "reader/active":
        this.#emitter.emit(event.event, event);
        break;
    }
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
    app.post("/notify", vValidator("json", notifyEventSchema), (c) => {
      const event = c.req.valid("json");
      logger.debug("Received notify event", { event: event.event });
      this.#dispatch(event);
      return c.body(null, 204);
    });

    const server = serve(
      { fetch: app.fetch, port: this.#port, hostname: this.#hostname },
      (info) =>
        logger.info("Server listening", {
          address: info.address,
          port: info.port,
        }),
    );
    server.on("error", (error) => {
      logger.error("Server error", { error });
    });
    this.#server = server;
  }

  async #stopServer(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    logger.info("Server stopped");
  }
}
