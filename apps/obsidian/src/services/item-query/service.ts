import { Stream } from "effect";
import { Cause, Effect, Exit, Fiber, FiberMap, Result, Scope } from "effect";
import { randomUUID } from "node:crypto";
import { link, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CliData, FileSystemAdapter, Vault } from "obsidian";

import type { CliRejection } from "@/lib/cli-params";
import { openScope } from "@/lib/effect-scope";
import type { SubscriptionRuntime } from "@/lib/effect-stream";
import { subscribe } from "@/lib/effect-stream";
import { systemCallError } from "@/lib/errno";
import { getLogger } from "@/lib/log";
import type { PlainLibraryScope } from "@/services/library-scope/plain";
import { Service } from "@/services/service-base";
import type { PlainUseLedger } from "@/services/use-ledger/plain";
import type { PlainZoteroPref } from "@/services/zotero-pref/plain";
import type { PlainZoteroReads } from "@/services/zotero-reads/plain";

import {
  QUERY_COMMAND,
  QUERY_SCHEMA_COMMAND,
  QUERY_VALUES_COMMAND,
  diagnostic,
  failure,
  queryCancelledText,
  queryIdInUseFailure,
  rejectionDiagnostic,
} from "./contract";
import type { QueryCliCommand } from "./contract";
import { decodeQuery, decodeSchemaArguments, decodeValues } from "./decode";
import type { QueryViewOutcome, QueryViewRequest } from "./query-view";
import type { CancellationEvent, QueryObserver } from "./trace";
import type {
  QueryAnswer,
  QueryCommand,
  QueryCustomFieldsCommand,
  QueryViewCommand,
} from "./worker-protocol";

interface QueryServiceDeps {
  runtime: SubscriptionRuntime;
  pluginVersion: string;
  useLedger: Pick<PlainUseLedger, "uses" | "changes">;
  reads: Pick<PlainZoteroReads, "reads">;
  zoteroPref: Pick<
    PlainZoteroPref,
    "sourceId" | "databasePath" | "dataDir" | "baseAttachmentPath"
  >;
  libraryScope: Pick<PlainLibraryScope, "effective">;
  vault: Vault;
}

/** Forks a job into the map of jobs under its key. */
type JobRunner = (
  key: string,
  job: Effect.Effect<unknown, unknown>,
  options: Effect.RunOptions,
) => Fiber.Fiber<unknown, unknown>;

/**
 * The key of a job that the caller does not name. A query id has no `:`, so
 * this key names no query.
 */
const unnamedKey = (): string => `:${randomUUID()}`;

/**
 * Owns the CLI jobs over the ZoteroReads worker: each job is a fiber in one
 * map, under its query id or an unnamed key. A job that the caller names with
 * `id` can be cancelled by that id until it settles; one service serves one
 * vault, so an id names one query in one vault. Unload interrupts every job
 * and waits for it.
 */
export class QueryService extends Service {
  readonly #runtime;
  readonly #deps;
  #jobs!: FiberMap.FiberMap<string, unknown>;
  #run!: JobRunner;
  ready: Promise<void>;
  #viewRuns = 0;

  constructor(deps: QueryServiceDeps) {
    super();
    this.#runtime = deps.runtime;
    this.#deps = deps;
    this.ready = this.#load();
  }

  /**
   * Changes to device Uses invalidate every open Query View: `callback` runs on
   * each Use recorded after this call.
   */
  on(_event: "changed", callback: () => void): () => void {
    return subscribe(
      this.#runtime,
      Stream.drop(this.#deps.useLedger.changes, 1),
      () => callback(),
    );
  }

  async #load(): Promise<void> {
    await using stack = new AsyncDisposableStack();
    // Before the first await: `answer` claims ids from the constructor on.
    const { scope, close } = openScope();
    stack.defer(close);
    this.#jobs = Effect.runSync(
      Scope.provide(FiberMap.make<string, unknown>(), scope),
    );
    this.#run = Effect.runSync(FiberMap.runtime(this.#jobs)());
    this.commit(stack.move());
  }

  /** Decode from and answer the shared query command. */
  query(params: CliData, signal: AbortSignal): Promise<string> {
    return this.#query({ params, signal });
  }

  /** Answer a query and report its measurement to `measure`. */
  measure(
    params: CliData,
    signal: AbortSignal,
    measure: QueryObserver & { heap: boolean },
  ): Promise<string> {
    return this.#query({ params, signal, measure });
  }

  #query({
    params,
    signal,
    measure,
  }: {
    params: CliData;
    signal: AbortSignal;
    measure?: QueryObserver & { heap: boolean };
  }): Promise<string> {
    // Decode and claim the id synchronously, so two calls with one id
    // cannot both start. The worker receives the decoded query.
    const command = QUERY_COMMAND;
    const request = decodeNow(command, decodeQuery(params));
    if (Result.isFailure(request)) return Promise.resolve(request.failure);
    const query = request.success;
    const { id } = query;
    if (id !== undefined && FiberMap.hasUnsafe(this.#jobs, id)) {
      return Promise.resolve(queryIdInUseFailure(id, command));
    }
    return this.#start(
      this.#job(
        { schema: false, dataset: query.from, command, query },
        measure,
      ),
      signal,
      id,
    );
  }

  /**
   * Run the typed query of a Query View: every row up to `request.limit`, as
   * parsed groups of rows. An invalid query, or a source that cannot answer,
   * gives the diagnostic of `zotlit:query` as data; an abort of `signal`
   * stops the query and gives `cancelled`.
   * @throws An internal error.
   */
  async run(
    request: QueryViewRequest,
    signal: AbortSignal,
  ): Promise<QueryViewOutcome> {
    if (__DEV__) this.#viewRuns++;
    const command: QueryViewCommand = {
      command: QUERY_COMMAND,
      schema: false,
      view: request,
    };
    const settled = await this.#settle(
      this.#send(command).pipe(
        Effect.map((answer) => {
          if (answer.view) return answer.view;
          throw new Error("ZotLit Query answered a typed query with text.");
        }),
      ),
      signal,
    );
    if (settled.done) return settled.value;
    return { kind: "cancelled" };
  }

  /** List Collection paths or Tag names through the same worker connection. */
  values(params: CliData, signal: AbortSignal): Promise<string> {
    const command = QUERY_VALUES_COMMAND;
    const request = decodeNow(command, decodeValues(params));
    if (Result.isFailure(request)) return Promise.resolve(request.failure);
    return this.#start(
      this.#job({ schema: false, command, values: request.success }),
      signal,
    );
  }

  /**
   * How many typed queries of a Query View the service started. Counted in
   * dev builds alone, for the End-to-end Run; `0` in production.
   */
  get viewRuns(): number {
    return this.#viewRuns;
  }

  /** The jobs that have not settled. */
  get runningJobs(): number {
    return Effect.runSync(FiberMap.size(this.#jobs));
  }

  /**
   * Request the cancel of the running query named `id`.
   * @returns `false` when no query with this id is running in this vault.
   */
  cancel(id: string): boolean {
    if (!FiberMap.hasUnsafe(this.#jobs, id)) return false;
    Effect.runFork(FiberMap.remove(this.#jobs, id));
    return true;
  }

  /** Answer the shared schema command, optionally narrowed by from. */
  schema(params: CliData, signal: AbortSignal): Promise<string> {
    const command = QUERY_SCHEMA_COMMAND;
    const request = decodeNow(command, decodeSchemaArguments(params));
    if (Result.isFailure(request)) return Promise.resolve(request.failure);
    const { from } = request.success;
    return this.#start(
      this.#job({
        schema: true,
        ...(from === undefined ? {} : { dataset: from }),
        command,
        pluginVersion: this.#deps.pluginVersion,
      }),
      signal,
    );
  }

  /**
   * The custom fields of the active Zotero source, by name; none when the
   * source cannot answer or `signal` aborts first.
   * @throws An internal error.
   */
  async customFieldNames(signal: AbortSignal): Promise<readonly string[]> {
    const settled = await this.#settle(
      this.#send({
        command: QUERY_SCHEMA_COMMAND,
        schema: false,
        customFields: true,
      }).pipe(Effect.map((answer) => answer.customFields ?? [])),
      signal,
    );
    if (settled.done) return settled.value;
    return [];
  }

  /**
   * Run `job` as a fiber of the map under `id`, or under an unnamed key
   * without one; `signal` interrupts it. The fiber is uninterruptible outside
   * the waits of the job, so an answer that arrives wins a later cancel. The
   * id of a named job is free once the returned promise settles.
   */
  #start(
    job: Effect.Effect<string, unknown>,
    signal: AbortSignal,
    id?: string,
  ): Promise<string> {
    return this.#settle(job, signal, id).then((settled) => {
      if (settled.done) return settled.value;
      if (signal.aborted) throw signal.reason;
      throw new DOMException(
        id === undefined || this.disposing
          ? "The query was cancelled."
          : queryCancelledText(id),
        "AbortError",
      );
    });
  }

  /**
   * Run `job` as a fiber of the map under `id`, or under an unnamed key
   * without one, until it settles; `signal` interrupts it.
   * @returns `done: false` when the job was interrupted.
   */
  #settle<A>(
    job: Effect.Effect<A, unknown>,
    signal: AbortSignal,
    id?: string,
  ): Promise<{ done: true; value: A } | { done: false }> {
    const fiber = this.#run(id ?? unnamedKey(), job, {
      signal,
      uninterruptible: true,
    });
    return Effect.runPromise(Fiber.await(fiber)).then((exit) => {
      if (Exit.isSuccess(exit)) return { done: true, value: exit.value as A };
      if (!Cause.hasInterruptsOnly(exit.cause)) throw Cause.squash(exit.cause);
      return { done: false };
    });
  }

  /**
   * One job: send the command to the worker and publish its export. The
   * staging file is removed when the job ends.
   */
  #job(
    command: QueryCommand,
    measure?: QueryObserver & { heap: boolean },
  ): Effect.Effect<string, unknown> {
    const send = this.#send.bind(this);
    return Effect.gen(function* () {
      const id = randomUUID();
      const output = command.schema ? undefined : command.query?.output;
      const stagePath =
        output === undefined ? undefined : yield* stageExport(output, id);
      const result = yield* send(command, { id, stagePath, measure });
      if (result.view)
        return yield* Effect.die(
          new Error("ZotLit Query answered a CLI command with data."),
        );
      if (stagePath !== undefined && result.receipt.kind === "file")
        return yield* publishExport({
          stagePath,
          output: result.receipt.path,
          answer: result.answer,
          command: result.command,
        });
      return result.answer;
    }).pipe(
      Effect.scoped,
      Effect.onInterrupt(() => reportCancel(measure, "cleanup-finished")),
    );
  }

  /**
   * Send one command to the worker and wait for its answer. An interrupt
   * while the worker runs the job sends `CancelItemQuery` and waits for the
   * answer, so the worker closes its writer and ends its borrow before the
   * job ends; a job that the worker cancelled interrupts.
   */
  #send(
    command: QueryCommand | QueryViewCommand | QueryCustomFieldsCommand,
    {
      id = randomUUID(),
      stagePath,
      measure,
    }: {
      id?: string;
      stagePath?: string | undefined;
      measure?: (QueryObserver & { heap: boolean }) | undefined;
    } = {},
  ): Effect.Effect<QueryAnswer, unknown> {
    const deps = this.#deps;
    const ready = this.ready;
    const report = (phase: CancellationEvent["phase"]) =>
      reportCancel(measure, phase);
    return Effect.gen(function* () {
      const reads = yield* Effect.interruptible(
        Effect.promise(async () => {
          await ready;
          return deps.reads.reads;
        }),
      ).pipe(Effect.onInterrupt(() => report("requested")));
      const call = yield* Effect.forkChild(
        reads
          .ItemQuery({
            job: {
              id,
              ...(stagePath ? { stagePath } : {}),
              ...command,
              source: {
                id: deps.zoteroPref.sourceId,
                databasePath: deps.zoteroPref.databasePath,
              },
              vault: {
                name: deps.vault.getName(),
                path: (deps.vault.adapter as FileSystemAdapter).getBasePath(),
              },
              scope: deps.libraryScope.effective,
              uses: deps.useLedger.uses,
              attachmentPaths: {
                dataDir: deps.zoteroPref.dataDir,
                baseAttachmentPath: deps.zoteroPref.baseAttachmentPath,
              },
              measure: measure !== undefined,
              ...(measure ? { heap: measure.heap } : {}),
            },
          })
          .pipe(
            Effect.catchTag("DbUnavailable", (error) => {
              const unavailable = diagnostic(
                "source-unavailable",
                error.message,
              );
              return Effect.succeed<QueryAnswer>(
                "view" in command
                  ? {
                      command: command.command,
                      answer: "",
                      receipt: { kind: "inline" },
                      view: { kind: "failed", diagnostic: unavailable },
                    }
                  : {
                      command: command.command,
                      answer: failure(command.command, unavailable),
                      receipt: { kind: "inline" },
                    },
              );
            }),
          ),
      );
      const result = yield* Effect.interruptible(Fiber.join(call)).pipe(
        Effect.onInterrupt(() =>
          report("requested").pipe(
            Effect.andThen(report("sent")),
            Effect.andThen(reads.CancelItemQuery({ id })),
            Effect.ignoreCause,
            Effect.ensuring(Fiber.await(call)),
          ),
        ),
      );
      if (result.cancelled) return yield* Effect.interrupt;
      if (result.measurement) measure?.completed(result.measurement);
      return result;
    });
  }
}

/**
 * Decode a command's parameters now, synchronously: the request, or the
 * diagnostic envelope of `command` for the parameter that rejects it. The
 * service is a legacy Service whose callers hold Promises; decoding before
 * any await lets `#query` claim a query id before a second call with the
 * same id can start.
 */
function decodeNow<A>(
  command: QueryCliCommand,
  decode: Effect.Effect<A, CliRejection>,
): Result.Result<A, string> {
  return Effect.runSync(
    decode.pipe(
      Effect.mapError((rejection) =>
        failure(command, rejectionDiagnostic(rejection)),
      ),
      Effect.result,
    ),
  );
}

/** Report one phase of a cancel to the measurement, when one observes. */
function reportCancel(
  measure: QueryObserver | undefined,
  phase: CancellationEvent["phase"],
): Effect.Effect<void> {
  return Effect.sync(() =>
    measure?.cancelled?.({
      phase,
      atEpochMs: Temporal.Now.instant().epochMilliseconds,
    }),
  );
}

/** The staging path of an export, beside its output; removed with the job. */
function stageExport(
  output: string,
  id: string,
): Effect.Effect<string, never, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.sync(() => join(dirname(output), `.zotlit-query-${id}.tmp`)),
    (stagePath) =>
      Effect.promise(() =>
        rm(stagePath, { force: true }).catch((error: unknown) => {
          getLogger(["item-query"]).warn(
            "ZotLit Query could not remove its temporary export {path}",
            { path: stagePath, error },
          );
        }),
      ),
  );
}

/**
 * Publish the closed staging file at `output`. A file at `output` stays: the
 * answer is then `output-error`.
 */
function publishExport({
  stagePath,
  output,
  answer,
  command,
}: {
  stagePath: string;
  output: string;
  answer: string;
  command: QueryCliCommand;
}): Effect.Effect<string> {
  return Effect.tryPromise({
    try: () => link(stagePath, output),
    catch: systemCallError,
  }).pipe(
    Effect.as(answer),
    Effect.catch((error) =>
      error.code !== undefined
        ? Effect.succeed(
            failure(command, diagnostic("output-error", error.message)),
          )
        : Effect.die(error.cause),
    ),
  );
}
