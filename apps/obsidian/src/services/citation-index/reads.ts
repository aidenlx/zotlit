// Owns the Citation Index's read capability and follows the interactive source.
import { Effect } from "effect";
import type { Scope } from "effect";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { getLogger } from "@/lib/log";
import type { LibraryScope } from "@/services/library-scope/scope";
import { Service } from "@/services/service-base";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import type { ReadsConfig } from "@/services/zotero-reads/rpc";
import { ZoteroReadsService } from "@/services/zotero-reads/service";
import type { ZoteroReadsEvents } from "@/services/zotero-reads/service";

import { CitationLookupAnswer } from "./lookup";
import type { CitationLookupRequest } from "./lookup";

const logger = getLogger("citation-index");

export interface CitationReadsDeps {
  settings: Pick<SettingsService, "ready" | "current" | "subscribe">;
  zoteroPref: Pick<ZoteroPrefService, "ready" | "databasePath" | "on">;
  source: Pick<ZoteroReadsService, "on">;
  /** Spawned on startup; every recovery obtains the latest configuration. */
  client: (
    config: () => ReadsConfig,
  ) => Effect.Effect<ZoteroReadsClient, never, Scope.Scope>;
}

/**
 * A second read capability for citation resolution. The primary source owns
 * change detection; this service follows its signals through one refresh lane.
 * Each signal invalidates the old generation before any asynchronous work.
 */
export class CitationReads extends Service {
  readonly #deps;
  readonly #events = createNanoEvents<ZoteroReadsEvents>();
  readonly #stop = new AbortController();
  #worker?: ZoteroReadsService;
  #generation = 0;
  #dirty = false;
  #stopped = false;
  #degraded = false;
  #lane: Promise<void> | null = null;
  #failure: unknown = null;
  #configured: ReadsConfig | null = null;
  ready: Promise<void>;

  constructor(deps: CitationReadsDeps) {
    super();
    this.#deps = deps;
    this.ready = this.#load();
  }

  get generation(): number {
    return this.#generation;
  }
  get state(): ZoteroReadsService["state"] {
    return this.#worker?.state ?? "loading";
  }

  on<K extends keyof ZoteroReadsEvents>(
    event: K,
    cb: ZoteroReadsEvents[K],
  ): () => void {
    return this.#events.on(event, cb);
  }

  /** A requested projection of the latest source and stable Library selectors. */
  readLookup(
    request: CitationLookupRequest,
    scope: LibraryScope | null,
    options: { signal?: AbortSignal } = {},
  ): Promise<CitationLookupAnswer> {
    const signal = options.signal
      ? AbortSignal.any([options.signal, this.#stop.signal])
      : this.#stop.signal;
    return Effect.runPromise(
      Effect.tryPromise({
        try: async (signal) => {
          await this.ready;
          while (true) {
            while (this.#lane) await this.#lane;
            signal.throwIfAborted();
            if (this.#failure) throw this.#failure;
            if (this.#stopped) throw new Error("Citation reads stopped");
            const generation = this.#generation;
            const { client } = await this.#worker!.ready;
            try {
              const answer = await Effect.runPromise(
                client.CitationLookup({
                  scope,
                  citekeys: request.citekeys ?? [],
                  indexedKeys: request.indexedKeys ?? [],
                }),
                { signal },
              );
              signal.throwIfAborted();
              if (generation !== this.#generation || this.#lane) continue;
              if (this.#failure) throw this.#failure;
              return new CitationLookupAnswer(answer);
            } catch (error) {
              signal.throwIfAborted();
              if (generation !== this.#generation || this.#lane) continue;
              throw error;
            }
          }
        },
        catch: (error) => error,
      }),
      { signal },
    );
  }

  /** Ensure the latest worker maps exist without transferring any entries. */
  async refreshLookup(
    scope: LibraryScope | null,
    options: { signal?: AbortSignal } = {},
  ): Promise<string> {
    return (await this.readLookup({}, scope, options)).revision;
  }

  #config(): ReadsConfig {
    const settings = this.#deps.settings.current;
    if (!settings) throw new Error("Citation read settings are not loaded");
    return {
      databasePath: this.#deps.zoteroPref.databasePath,
      readMode: settings["zotero.read-mode"],
      autoRefresh: false,
      locale: null,
      chineseSegmenter: null,
      logLevel: settings["log.level"],
    };
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    // Subscribe before waiting on dependencies or spawning: a startup change
    // marks the next generation even while the worker is still connecting.
    stack.defer(this.#deps.source.on("changed", () => this.#request()));
    stack.defer(
      this.#deps.source.on("refresh-requested", () => this.#request()),
    );
    stack.defer(
      this.#deps.zoteroPref.on("resolved-changed", () => this.#request()),
    );
    stack.defer(
      this.#deps.settings.subscribe(() => {
        if (!this.#deps.settings.current) return;
        const config = this.#config();
        if (
          config.databasePath !== this.#configured?.databasePath ||
          config.readMode !== this.#configured.readMode ||
          config.logLevel !== this.#configured.logLevel
        )
          this.#request();
      }),
    );
    await Promise.all([this.#deps.settings.ready, this.#deps.zoteroPref.ready]);
    this.#worker = stack.use(
      new ZoteroReadsService({
        client: this.#deps.client(() => this.#config()),
      }),
    );
    stack.defer(
      this.#worker.on("degraded", (error) => {
        this.#failure = error;
        this.#degraded = true;
        this.#generation += 1;
        this.#events.emit("changed");
        this.#events.emit("degraded", error);
      }),
    );
    stack.defer(
      this.#worker.on("changed", () => {
        if (!this.#degraded) return;
        this.#degraded = false;
        this.#request();
      }),
    );
    await this.#worker.ready;
    stack.defer(() => {
      this.#stopped = true;
      this.#stop.abort();
    });
    this.#request();
    this.commit(stack.move());
  }

  #request(): void {
    if (this.#stopped) return;
    this.#generation += 1;
    this.#dirty = true;
    // Assignment precedes notification: a consumer awakened by changed waits
    // for this refresh rather than acquiring the previous connection.
    if (this.#worker && !this.#lane) {
      this.#lane = this.#synchronize().finally(() => {
        this.#lane = null;
        if (this.#stopped) return;
        if (this.#dirty) this.#request();
        else this.#events.emit("changed");
      });
    }
    this.#events.emit("changed");
  }

  async #synchronize(): Promise<void> {
    const worker = this.#worker!;
    const { client } = await worker.ready;
    while (this.#dirty && !this.#stopped) {
      this.#dirty = false;
      const config = this.#config();
      this.#configured = config;
      try {
        await Effect.runPromise(
          Effect.andThen(client.Configure(config), client.Refresh()),
          { signal: this.#stop.signal },
        );
        this.#failure = null;
      } catch (error) {
        this.#failure = error;
        if (!this.#stopped)
          logger.warn("Citation source refresh failed", { error });
      }
    }
  }
}
