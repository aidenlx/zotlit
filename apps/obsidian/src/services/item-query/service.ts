import { abortable } from "@std/async/abortable";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import type { FileSystemAdapter, Vault } from "obsidian";

import type { LibraryScopeService } from "@/services/library-scope/service";
import { Service } from "@/services/service-base";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import {
  diagnostic,
  failure,
  itemQueryArgumentFailure,
  ITEM_QUERY_COMMAND,
  ITEM_QUERY_SCHEMA_COMMAND,
  queryIdInUseFailure,
} from "./cli";
import { queryCancelledText } from "./contract";
import { QueryExport } from "./export";
import type { QueryObserver } from "./trace";
import type { QueryAnswer } from "./worker";
import type { QueryJob } from "./worker-protocol";

interface ItemQueryServiceDeps {
  reads: ZoteroReadsService;
  zoteroPref: Pick<ZoteroPrefService, "sourceId" | "databasePath">;
  libraryScope: LibraryScopeService;
  vault: Vault;
}

/**
 * Owns named CLI jobs over the ZoteroReads worker. A job that the caller names with `id` can be cancelled by that id
 * until it settles; one service serves one vault, so an id names one query in
 * one vault.
 */
export class ItemQueryService extends Service {
  readonly #deps;
  readonly #unload = new AbortController();
  readonly #jobs = new Set<Promise<string>>();
  readonly #named = new Map<string, AbortController>();
  ready: Promise<void>;

  constructor(deps: ItemQueryServiceDeps) {
    super();
    this.#deps = deps;
    this.ready = this.#load();
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    await this.#deps.reads.ready;
    await this.#deps.libraryScope.ready;
    stack.defer(async () => {
      this.#unload.abort();
      await Promise.allSettled(this.#jobs);
    });
    this.commit(stack.move());
  }

  answer(
    params: QueryJob["params"],
    signal: AbortSignal,
    measure?: QueryObserver & { heap: boolean },
  ): Promise<string> {
    // Validate and claim the id synchronously, so two calls with one id
    // cannot both start.
    const rejected = itemQueryArgumentFailure(params);
    if (rejected) return Promise.resolve(rejected);
    const id = params.id;
    if (id !== undefined && this.#named.has(id)) {
      return Promise.resolve(queryIdInUseFailure(id));
    }
    const named = new AbortController();
    if (id !== undefined) this.#named.set(id, named);
    const combined = AbortSignal.any([
      signal,
      this.#unload.signal,
      named.signal,
    ]);
    const requested = () =>
      measure?.cancelled?.({
        phase: "requested",
        atEpochMs: Temporal.Now.instant().epochMilliseconds,
      });
    combined.addEventListener("abort", requested, { once: true });
    // The id is free before the caller sees the query settle. A listener
    // keeps the combined signal alive as long as its unload sources.
    const job = this.#answer(params, combined, { measure }).finally(() => {
      combined.removeEventListener("abort", requested);
      if (combined.aborted)
        measure?.cancelled?.({
          phase: "cleanup-finished",
          atEpochMs: Temporal.Now.instant().epochMilliseconds,
        });
      if (id !== undefined) this.#named.delete(id);
    });
    this.#jobs.add(job);
    void job.then(
      () => this.#jobs.delete(job),
      () => this.#jobs.delete(job),
    );
    return job;
  }

  /**
   * Request the cancel of the running query named `id`.
   * @returns `false` when no query with this id is running in this vault.
   */
  cancel(id: string): boolean {
    const named = this.#named.get(id);
    if (!named) return false;
    named.abort(new DOMException(queryCancelledText(id), "AbortError"));
    return true;
  }

  schema(params: QueryJob["params"], signal: AbortSignal): Promise<string> {
    const job = this.#answer(
      params,
      AbortSignal.any([signal, this.#unload.signal]),
      { schema: true },
    );
    this.#jobs.add(job);
    void job.then(
      () => this.#jobs.delete(job),
      () => this.#jobs.delete(job),
    );
    return job;
  }

  async #answer(
    params: QueryJob["params"],
    signal: AbortSignal,
    {
      measure,
      schema = false,
    }: { measure?: QueryObserver & { heap: boolean }; schema?: boolean } = {},
  ): Promise<string> {
    signal.throwIfAborted();
    await abortable(this.ready, signal);
    signal.throwIfAborted();
    const { reads } = await this.#deps.reads.ready;
    const id = randomUUID();
    await using output = new QueryExport(
      schema ? undefined : params.output,
      id,
    );
    const { stagePath } = output;
    const pending = Effect.runPromise(
      reads
        .ItemQuery({
          job: {
            id,
            ...(stagePath ? { stagePath } : {}),
            params,
            source: {
              id: this.#deps.zoteroPref.sourceId,
              databasePath: this.#deps.zoteroPref.databasePath,
            },
            vault: {
              name: this.#deps.vault.getName(),
              path: (
                this.#deps.vault.adapter as FileSystemAdapter
              ).getBasePath(),
            },
            scope: this.#deps.libraryScope.effective,
            schema,
            measure: measure !== undefined,
            ...(measure ? { heap: measure.heap } : {}),
          },
        })
        .pipe(
          Effect.catchTag("DbUnavailable", (error) =>
            Effect.succeed({
              answer: failure(
                schema ? ITEM_QUERY_SCHEMA_COMMAND : ITEM_QUERY_COMMAND,
                diagnostic("source-unavailable", error.message),
              ),
            }),
          ),
        ),
    ).catch((error: unknown) => {
      signal.throwIfAborted();
      throw error;
    });
    const cancel = () => {
      measure?.cancelled?.({
        phase: "sent",
        atEpochMs: Temporal.Now.instant().epochMilliseconds,
      });
      void Effect.runPromise(reads.CancelItemQuery({ id })).catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      const result: QueryAnswer = await pending;
      signal.throwIfAborted();
      if (result.cancelled)
        throw new DOMException("Item Query cancelled", "AbortError");
      if (result.measurement) measure?.completed(result.measurement);
      await output.publish(result.answer, signal);
      return result.answer;
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof Error) || !("code" in error)) throw error;
      return failure(
        ITEM_QUERY_COMMAND,
        diagnostic("output-error", error.message),
      );
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  }
}
