// Owns the Citation Index's read capability and follows the interactive source.
import { Deferred, Effect } from "effect";
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
 * change detection; this service sends its generation with each lookup.
 * Each signal invalidates the old generation before any asynchronous work.
 */
export class CitationReads extends Service {
  readonly #deps;
  readonly #events = createNanoEvents<ZoteroReadsEvents>();
  readonly #stop = Deferred.makeUnsafe<never>();
  #worker?: ZoteroReadsService;
  #generation = 0;
  #degraded = false;
  #observed: ReadsConfig | null = null;
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
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        yield* Effect.tryPromise(() => this.ready);
        const { client } = yield* Effect.tryPromise(() => this.#worker!.ready);
        while (true) {
          const generation = this.#generation;
          const result = yield* Effect.result(
            client.CitationLookup({
              generation,
              config: this.#config(),
              scope,
              citekeys: request.citekeys ?? [],
              indexedKeys: request.indexedKeys ?? [],
            }),
          );
          const answeredGeneration =
            result._tag === "Success" ? result.success.generation : generation;
          if (answeredGeneration < this.#generation) {
            logger.debug("Retrying an obsolete citation reply", {
              generation: answeredGeneration,
              nextGeneration: this.#generation,
              outcome: result._tag,
            });
            continue;
          }
          if (result._tag === "Failure") return yield* result.failure;
          return new CitationLookupAnswer(result.success);
        }
      }).pipe(Effect.raceFirst(Deferred.await(this.#stop))),
      { signal: options.signal },
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
          config.databasePath !== this.#observed?.databasePath ||
          config.readMode !== this.#observed.readMode ||
          config.logLevel !== this.#observed.logLevel
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
        if (!this.#degraded) {
          this.#generation += 1;
          this.#events.emit("changed");
        }
        this.#degraded = true;
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
      Effect.runSync(Deferred.interrupt(this.#stop));
    });
    this.#request();
    this.commit(stack.move());
  }

  #request(): void {
    if (this.disposing) return;
    this.#generation += 1;
    if (this.#deps.settings.current) this.#observed = this.#config();
    this.#events.emit("changed");
    const worker = this.#worker;
    if (!worker || !this.#observed) return;
    const source = { generation: this.#generation, config: this.#observed };
    // Prefetch also wakes CitationIndex after recovery. Lookup carries the
    // same source token, so a missed notification cannot make a read stale.
    void Effect.runPromise(
      Effect.tryPromise(() => worker.ready).pipe(
        Effect.flatMap(({ client }) => client.CitationRefresh(source)),
        Effect.raceFirst(Deferred.await(this.#stop)),
      ),
    ).catch((error: unknown) => {
      if (!this.disposing)
        logger.warn("Citation source refresh failed", { error });
    });
  }
}
