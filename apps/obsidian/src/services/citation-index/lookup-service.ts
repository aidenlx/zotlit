// Citation Lookup: fresh command reads and view-owned Held Reads of requested keys.
import { QueryObserver } from "@tanstack/query-core";
import type { QueryObserverOptions } from "@tanstack/query-core";
import { Deferred, Effect } from "effect";
import type { Scope } from "effect";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { getLogger } from "@/lib/log";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { Held, QueryClientService } from "@/services/query-client/service";
import { Service } from "@/services/service-base";
import type { SettingsService } from "@/services/settings/service";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsClient } from "@/services/zotero-reads/in-process";
import type { ReadsConfig } from "@/services/zotero-reads/rpc";
import { ZoteroReadsService } from "@/services/zotero-reads/service";

import { CitationLookupAnswer } from "./lookup";
import type { CitationLookupRequest } from "./lookup";

const logger = getLogger("citation-index");

export interface CitationLookupDeps {
  queryClient: QueryClientService;
  libraryScope: Pick<LibraryScopeService, "ready" | "effective" | "on">;
  settings: Pick<SettingsService, "ready" | "current" | "subscribe">;
  zoteroPref: Pick<ZoteroPrefService, "ready" | "databasePath" | "on">;
  source: Pick<ZoteroReadsService, "on">;
  /** Spawned on startup; every recovery obtains the latest configuration. */
  client: (
    config: () => ReadsConfig,
  ) => Effect.Effect<ZoteroReadsClient, never, Scope.Scope>;
}

export interface CitationLookupObservation extends Disposable {
  readonly current: Held<CitationLookupAnswer> | null;
  set(request: CitationLookupRequest): void;
}

export type CitationLookupStatus =
  | Held<CitationLookupAnswer>["status"]
  | "pending";

interface LookupEvents {
  /** A new worker revision was published. */
  changed: () => void;
  /** Freshness changed, including recovery at the same revision. */
  "status-changed": () => void;
  invalidated: () => void;
  stopped: () => void;
}

const LOOKUP_KEY = ["citation-lookup"] as const;
const GC_TIME = Temporal.Duration.from({ minutes: 5 }).total("milliseconds");

/** Owns signal intake, worker generations, and the answers open views hold. */
export class CitationLookup extends Service {
  readonly #deps;
  readonly #events = createNanoEvents<LookupEvents>();
  readonly #stop = Deferred.makeUnsafe<never>();
  #worker?: ZoteroReadsService;
  #generation = 0;
  #degraded = false;
  #observed: ReadsConfig | null = null;
  #status: CitationLookupStatus = "pending";
  #revision: string | null = null;
  #refresh: Promise<unknown> = Promise.resolve();
  ready: Promise<void>;

  constructor(deps: CitationLookupDeps) {
    super();
    this.#deps = deps;
    this.ready = this.#load();
  }

  get status(): CitationLookupStatus {
    return this.#status;
  }

  on<K extends "changed" | "status-changed">(
    event: K,
    cb: LookupEvents[K],
  ): () => void {
    return this.#events.on(event, cb);
  }

  /** A fresh answer from one published revision; unavailable reads reject. */
  read(
    request: CitationLookupRequest,
    { signal }: { signal?: AbortSignal } = {},
  ): Promise<CitationLookupAnswer> {
    const citekeys = [...new Set(request.citekeys ?? [])];
    const indexedKeys = [...new Set(request.indexedKeys ?? [])];
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        yield* Effect.tryPromise(() => this.ready);
        yield* Effect.tryPromise(() => this.#deps.libraryScope.ready);
        const { client } = yield* Effect.tryPromise(() => this.#worker!.ready);
        while (true) {
          const generation = this.#generation;
          const scope = this.#deps.libraryScope.effective;
          const result = yield* Effect.result(
            client.CitationLookup({
              generation,
              config: this.#config(),
              scope,
              citekeys,
              indexedKeys,
            }),
          );
          const answeredGeneration =
            result._tag === "Success" ? result.success.generation : generation;
          if (
            answeredGeneration < this.#generation ||
            JSON.stringify(scope) !==
              JSON.stringify(this.#deps.libraryScope.effective)
          )
            continue;
          if (result._tag === "Failure") {
            this.#setStatus("failed");
            return yield* result.failure;
          }
          const answer = new CitationLookupAnswer(result.success);
          const changed = this.#revision !== answer.revision;
          this.#revision = answer.revision;
          this.#setStatus("fresh");
          if (changed) this.#events.emit("changed");
          return answer;
        }
      }).pipe(Effect.raceFirst(Deferred.await(this.#stop))),
      { signal },
    );
  }

  /** Pins only this view's query. Request changes use its previous answer as a placeholder. */
  observe(changed: () => void): CitationLookupObservation {
    const client = this.#deps.queryClient.client;
    let request: CitationLookupRequest | null = null;
    let identity: string | null = null;
    let current: Held<CitationLookupAnswer> | null = null;
    let previous: CitationLookupAnswer | undefined;
    let disposed = false;
    const options = (): QueryObserverOptions<CitationLookupAnswer> => ({
      queryKey: [
        ...LOOKUP_KEY,
        this.#deps.libraryScope.effective,
        request?.citekeys ?? [],
        request?.indexedKeys ?? [],
      ],
      queryFn: ({ signal }) => this.read(request!, { signal }),
      enabled: request !== null,
      gcTime: GC_TIME,
      placeholderData: (answer) => answer ?? previous,
      structuralSharing: (old, answer) =>
        old instanceof CitationLookupAnswer &&
        old.revision === (answer as CitationLookupAnswer).revision
          ? old
          : answer,
    });
    const observer = new QueryObserver(client, options());
    const publish = (): void => {
      if (disposed) return;
      const result = observer.getCurrentResult();
      // query-core drops placeholderData on error. The view still owns the
      // last delivered answer, including one from its previous request.
      const value = result.data ?? previous;
      previous = value;
      const query = observer.getCurrentQuery();
      current =
        value === undefined
          ? null
          : {
              value,
              status:
                result.isFetching || (result.isStale && !result.isError)
                  ? "revalidating"
                  : result.isError
                    ? "failed"
                    : "fresh",
              settled: Promise.resolve()
                .then(() => query.promise)
                .then(
                  (answer) => answer ?? value,
                  () => (disposed ? null : value),
                ),
            };
      try {
        changed();
      } catch (error) {
        logger.warn("Lookup observer failed", { error });
      }
    };
    const unsubscribe = observer.subscribe(publish);
    const offInvalidated = this.#events.on("invalidated", () => {
      if (request) observer.setOptions(options());
    });
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      observer.destroy();
      offInvalidated();
      offStopped();
      current = null;
      previous = undefined;
    };
    const offStopped = this.#events.on("stopped", dispose);
    if (this.disposing) dispose();
    return {
      get current() {
        return current;
      },
      set(next) {
        if (disposed) return;
        const selected = {
          citekeys: [...new Set(next.citekeys ?? [])].sort(),
          indexedKeys: [...new Set(next.indexedKeys ?? [])].sort(),
        };
        const nextIdentity = JSON.stringify(selected);
        if (identity === nextIdentity) return;
        identity = nextIdentity;
        request = selected;
        observer.setOptions(options());
      },
      [Symbol.dispose]: dispose,
    };
  }

  /** Wait for the current publication attempt, including a failed attempt or unload. */
  async whenResolved(): Promise<void> {
    await this.ready;
    await this.#refresh;
  }

  #setStatus(status: CitationLookupStatus): void {
    if (this.disposing || this.#status === status) return;
    const previous = this.#status;
    this.#status = status;
    this.#events.emit("status-changed");
    if (status === "fresh" && previous === "failed")
      void this.#deps.queryClient.client.refetchQueries({
        queryKey: LOOKUP_KEY,
        type: "active",
        predicate: (query) => query.state.status === "error",
      });
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
    // A scope change keeps the source: every read carries the scope, so the
    // worker rebuilds membership through stable selectors without a refresh.
    stack.defer(this.#deps.libraryScope.on("changed", () => this.#rescope()));
    stack.defer(
      this.#deps.libraryScope.on("libraries-changed", () => this.#rescope()),
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
          this.#invalidate();
        }
        this.#degraded = true;
        this.#setStatus("failed");
        logger.warn("Citation worker unavailable", { error });
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
      this.#events.emit("stopped");
      this.#deps.queryClient.client.removeQueries({ queryKey: LOOKUP_KEY });
    });
    this.#request();
    this.commit(stack.move());
  }

  #request(): void {
    if (this.disposing) return;
    this.#generation += 1;
    if (this.#deps.settings.current) this.#observed = this.#config();
    this.#invalidate();
    const worker = this.#worker;
    if (!worker || !this.#observed) return;
    const source = { generation: this.#generation, config: this.#observed };
    // The worker owns the refresh lane. Every read also carries this token.
    void Effect.runPromise(
      Effect.tryPromise(() => worker.ready).pipe(
        Effect.flatMap(({ client }) => client.CitationRefresh(source)),
        Effect.raceFirst(Deferred.await(this.#stop)),
      ),
    ).catch((error: unknown) => {
      if (!this.disposing)
        logger.warn("Citation source refresh failed", { error });
    });
    this.#refresh = this.read({}).catch((error: unknown) => {
      if (!this.disposing)
        logger.warn("Citation lookup refresh failed", { error });
    });
  }

  #rescope(): void {
    if (this.disposing) return;
    this.#invalidate();
    this.#refresh = this.read({}).catch((error: unknown) => {
      if (!this.disposing)
        logger.warn("Citation lookup refresh failed", { error });
    });
  }

  #invalidate(): void {
    this.#setStatus(this.#revision === null ? "pending" : "revalidating");
    this.#deps.queryClient.invalidate(LOOKUP_KEY);
    this.#events.emit("invalidated");
    void this.#deps.queryClient.client.refetchQueries({
      queryKey: LOOKUP_KEY,
      type: "active",
    });
  }
}
