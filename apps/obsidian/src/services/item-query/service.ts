import { abortable } from "@std/async/abortable";
import { randomUUID } from "node:crypto";
import { link, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FileSystemAdapter, Vault } from "obsidian";
import workerSource from "virtual:item-query-worker";

import { getLogger } from "@/lib/log";
import type { DatabaseService } from "@/services/database/service";
import { isolatedProcessRuntime } from "@/services/isolated-process";
import type { LibraryScopeService } from "@/services/library-scope/service";
import { Service } from "@/services/service-base";

import {
  diagnostic,
  failure,
  itemQueryArgumentFailure,
  ITEM_QUERY_CANCEL_COMMAND,
  ITEM_QUERY_COMMAND,
  queryIdInUseFailure,
} from "./cli";
import type { QueryObserver } from "./trace";
import type { QueryJob } from "./worker-protocol";
import { QueryWorkers } from "./workers";
import type { QueryWorkerFactory } from "./workers";

const logger = getLogger(["item-query"]);

interface ItemQueryServiceDeps {
  db: DatabaseService;
  libraryScope: LibraryScopeService;
  vault: Vault;
  /** Electron utility processes in production; Node workers in behavior tests. */
  createWorker?: QueryWorkerFactory;
}

/**
 * Owns query jobs, pinned reads, bounded workers, and publication of complete
 * exports. A job that the caller names with `id` can be cancelled by that id
 * until it settles; one service serves one vault, so an id names one query in
 * one vault.
 */
export class ItemQueryService extends Service<QueryWorkers> {
  readonly #deps;
  readonly #unload = new AbortController();
  readonly #jobs = new Set<Promise<string>>();
  readonly #named = new Map<string, AbortController>();
  ready: Promise<QueryWorkers>;

  constructor(deps: ItemQueryServiceDeps) {
    super();
    this.#deps = deps;
    this.ready = this.#load();
  }

  async #load(): Promise<QueryWorkers> {
    await using stack = new AsyncDisposableStack();
    await this.#deps.db.ready;
    await this.#deps.libraryScope.ready;
    const createWorker =
      this.#deps.createWorker ??
      stack.use(
        await isolatedProcessRuntime(workerSource, {
          prefix: "zotlit-query-process-",
          serviceName: "ZotLit Item Query",
        }),
      ).create;
    const workers = stack.use(new QueryWorkers(createWorker));
    stack.defer(async () => {
      this.#unload.abort();
      await Promise.allSettled(this.#jobs);
    });
    await workers.ready;
    this.commit(stack.move());
    return workers;
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
    combined.addEventListener(
      "abort",
      () => measure?.cancelled?.({ phase: "requested", atEpochMs: Date.now() }),
      { once: true },
    );
    // The id is free before the caller sees the query settle.
    const job = this.#answer(params, combined, measure).finally(() => {
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
    named.abort(
      new DOMException(
        `The query '${id}' was cancelled by ${ITEM_QUERY_CANCEL_COMMAND}.`,
        "AbortError",
      ),
    );
    return true;
  }

  async #answer(
    params: QueryJob["params"],
    signal: AbortSignal,
    measure?: QueryObserver & { heap: boolean },
  ): Promise<string> {
    signal.throwIfAborted();
    const workers = await abortable(this.ready, signal);
    signal.throwIfAborted();
    const output = params.output;
    let acquired;
    try {
      acquired = await this.#deps.db.acquireRead(signal);
    } catch (error) {
      signal.throwIfAborted();
      return failure(
        ITEM_QUERY_COMMAND,
        diagnostic(
          "source-unavailable",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
    using lease = acquired;
    signal.throwIfAborted();
    const stagePath =
      output === undefined
        ? undefined
        : join(dirname(output), `.zotlit-query-${randomUUID()}.tmp`);
    // Removing the private name and stopping its writer are independent.
    // Start both on cancellation; the final pass covers a create/remove race.
    let removing: Promise<void> | undefined;
    const removeOnCancel = () => {
      if (stagePath) removing = rm(stagePath, { force: true }).catch(() => {});
    };
    signal.addEventListener("abort", removeOnCancel, { once: true });
    try {
      const answer = await workers.answer(
        {
          params,
          uri: lease.uri,
          source: lease.source,
          vault: {
            name: this.#deps.vault.getName(),
            path: (this.#deps.vault.adapter as FileSystemAdapter).getBasePath(),
          },
          scope: this.#deps.libraryScope.effective,
          stagePath,
          measure: measure !== undefined,
          heap: measure?.heap,
        },
        signal,
        measure,
      );
      signal.throwIfAborted();
      if (stagePath && output) {
        const receipt = JSON.parse(answer) as { ok: boolean; file?: object };
        if (receipt.ok && receipt.file) {
          // A hard link publishes the finished file atomically and refuses to
          // replace an existing file. Once it succeeds, completion wins a cancel.
          await link(stagePath, output);
        }
      }
      return answer;
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof Error) || !("code" in error)) throw error;
      return failure(
        ITEM_QUERY_COMMAND,
        diagnostic("output-error", error.message),
      );
    } finally {
      signal.removeEventListener("abort", removeOnCancel);
      await removing;
      // A terminated worker has closed its file before answer() rejects.
      if (stagePath) {
        await rm(stagePath, { force: true }).catch((error: unknown) => {
          logger.warn(
            "Item Query could not remove its temporary export {path}",
            { path: stagePath, error },
          );
        });
      }
      if (signal.aborted)
        measure?.cancelled?.({
          phase: "cleanup-finished",
          atEpochMs: Date.now(),
        });
    }
  }
}
