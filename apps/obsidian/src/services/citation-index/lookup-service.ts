// Citation Lookup: fresh command reads and view-owned Held Reads of requested keys.
import { QueryObserver } from "@tanstack/query-core";
import type { QueryObserverOptions } from "@tanstack/query-core";

import { createNanoEvents } from "@zotlit/shared/nanoevents";

import { Deferred, Effect } from "@/lib/effect";
import { getLogger } from "@/lib/log";
import type { LibraryScopeService } from "@/services/library-scope/service";
import type { Held, QueryClientService } from "@/services/query-client/service";
import { Service } from "@/services/service-base";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import { CitationLookupAnswer } from "./lookup";
import type { CitationLookupRequest } from "./lookup";

const logger = getLogger("citation-index");

export interface CitationLookupDeps {
  queryClient: QueryClientService;
  libraryScope: Pick<LibraryScopeService, "ready" | "effective" | "on">;
  reads: Pick<ZoteroReadsService, "ready" | "state" | "on">;
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

/** Owns signal intake and the answers open views hold. */
export class CitationLookup extends Service {
  readonly #deps;
  readonly #events = createNanoEvents<LookupEvents>();
  readonly #stop = Deferred.makeUnsafe<never>();
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
        const { client } = yield* Effect.tryPromise(
          () => this.#deps.reads.ready,
        );
        while (true) {
          if (this.#deps.reads.state !== "ready") {
            this.#setStatus("failed");
            return yield* new DbUnavailable({
              message: "ZoteroReads is unavailable",
            });
          }
          const scope = this.#deps.libraryScope.effective;
          const result = yield* Effect.result(
            client.CitationLookup({
              scope,
              citekeys,
              indexedKeys,
            }),
          );
          if (
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

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    stack.defer(this.#deps.reads.on("changed", () => this.#revalidate()));
    stack.defer(
      this.#deps.reads.on("degraded", (error) => {
        this.#invalidate();
        this.#setStatus("failed");
        logger.warn("ZoteroReads unavailable", { error });
      }),
    );
    // A scope change keeps the source: every read carries the scope, so the
    // worker rebuilds membership through stable selectors without a refresh.
    stack.defer(
      this.#deps.libraryScope.on("changed", () => this.#revalidate()),
    );
    stack.defer(
      this.#deps.libraryScope.on("libraries-changed", () => this.#revalidate()),
    );
    stack.defer(() => {
      Effect.runSync(Deferred.interrupt(this.#stop));
      this.#events.emit("stopped");
      this.#deps.queryClient.client.removeQueries({ queryKey: LOOKUP_KEY });
    });
    // Let the constructor assign ready before read() waits for it.
    await Promise.resolve();
    this.#revalidate();
    this.commit(stack.move());
  }

  #revalidate(): void {
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
