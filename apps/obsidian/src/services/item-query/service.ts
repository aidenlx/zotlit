import { randomUUID } from "node:crypto";
import { link, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CliData, FileSystemAdapter, Vault } from "obsidian";

import { Cause, Effect, Exit, Fiber, FiberMap, Scope } from "@/lib/effect";
import { openScope } from "@/lib/effect-scope";
import { getLogger } from "@/lib/log";
import type { LibraryScopeService } from "@/services/library-scope/service";
import { Service } from "@/services/service-base";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

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
  QueryViewCommand,
} from "./worker-protocol";

interface QueryServiceDeps {
  pluginVersion: string;
  reads: ZoteroReadsService;
  zoteroPref: Pick<
    ZoteroPrefService,
    "sourceId" | "databasePath" | "dataDir" | "baseAttachmentPath"
  >;
  libraryScope: LibraryScopeService;
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
  readonly #deps;
  #jobs!: FiberMap.FiberMap<string, unknown>;
  #run!: JobRunner;
  /** The failure of startup: every job then rejects with it. */
  #startup: { failed: true; error: unknown } | undefined;
  ready: Promise<void>;

  constructor(deps: QueryServiceDeps) {
    super();
    this.#deps = deps;
    this.ready = this.#load();
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
    try {
      await this.#deps.reads.ready;
      await this.#deps.libraryScope.ready;
    } catch (error) {
      // Recorded before the stack closes the jobs, which then reject with it.
      this.#startup = { failed: true, error };
      throw error;
    }
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
    const request = decodeQuery(params);
    if (request.kind === "invalid") {
      return Promise.resolve(failure(command, rejectionDiagnostic(request)));
    }
    const query = request.value;
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
   * @throws The startup failure of the service, or an internal error.
   */
  async run(
    request: QueryViewRequest,
    signal: AbortSignal,
  ): Promise<QueryViewOutcome> {
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
    if (this.#startup) throw this.#startup.error;
    return { kind: "cancelled" };
  }

  /** List Collection paths or Tag names through the same worker connection. */
  values(params: CliData, signal: AbortSignal): Promise<string> {
    const command = QUERY_VALUES_COMMAND;
    const request = decodeValues(params);
    if (request.kind === "invalid")
      return Promise.resolve(failure(command, rejectionDiagnostic(request)));
    return this.#start(
      this.#job({ schema: false, command, values: request.value }),
      signal,
    );
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
    const rejected = decodeSchemaArguments(params);
    if (rejected.kind === "invalid") {
      return Promise.resolve(failure(command, rejectionDiagnostic(rejected)));
    }
    return this.#start(
      this.#job({
        schema: true,
        ...(rejected.value.from === undefined
          ? {}
          : { dataset: rejected.value.from }),
        command,
        pluginVersion: this.#deps.pluginVersion,
      }),
      signal,
    );
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
      if (this.#startup) throw this.#startup.error;
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
    command: QueryCommand | QueryViewCommand,
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
          return (await deps.reads.ready).reads;
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
    catch: (error) => error,
  }).pipe(
    Effect.as(answer),
    Effect.catch((error) =>
      error instanceof Error && "code" in error
        ? Effect.succeed(
            failure(command, diagnostic("output-error", error.message)),
          )
        : Effect.die(error),
    ),
  );
}
