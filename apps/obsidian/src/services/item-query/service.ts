// ZotLit Query in the renderer: the Query Jobs that the ZoteroReads worker answers.
import {
  Cause,
  Clock,
  Context,
  Effect,
  Exit,
  Fiber,
  FiberMap,
  FileSystem,
  Layer,
  Option,
  Result,
  Schema,
  Scope,
  Stream,
} from "effect";
import type { PlatformError } from "effect/PlatformError";
import type { RpcClientError } from "effect/rpc";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { CliData } from "obsidian";

import type { CliRejection } from "@/lib/cli-params";
import { awaitOwned } from "@/lib/effect-fiber";
import { withLogCategory } from "@/lib/effect-log";
import { isScopeClosed } from "@/lib/effect-scope";
import { ObsidianEnv } from "@/lib/obsidian-env";
import { LibraryScope } from "@/services/library-scope/service";
import { UseLedger } from "@/services/use-ledger/service";
import { ZoteroPref } from "@/services/zotero-pref/service";
import type { SnapshotExpired } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";

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

/**
 * How one ItemQuery call to the worker fails once `send` answers its
 * `DbUnavailable` with a diagnostic: the read snapshot expired, or the RPC
 * transport failed.
 */
export type ItemQueryError = SnapshotExpired | RpcClientError.RpcClientError;

/**
 * A CLI job ended without an answer: `zotlit:query-cancel` stopped it, or
 * the plugin unloaded. `message` is the text the CLI prints.
 */
export class QueryCancelled extends Schema.TaggedError<
  QueryCancelled,
  { readonly brand: unique symbol }
>()("QueryCancelled", { message: Schema.String }) {}

/** What a measured run reports to, beside the heap switch. */
export type QueryMeasure = QueryObserver & { heap: boolean };

/**
 * The CLI jobs over the ZoteroReads worker: each job is a fiber in one map,
 * under its query id or an unnamed key. A job that the caller names with
 * `id` can be cancelled by that id until it settles; one service serves one
 * vault, so an id names one query in one vault. Interrupting a caller
 * interrupts its job, and closing the layer interrupts every job and waits
 * for it.
 */
export class QueryService extends Context.Service<
  QueryService,
  {
    /**
     * Decode from and answer the shared query command. An id that names a
     * running query answers `query-id-in-use`.
     */
    query(
      params: CliData,
    ): Effect.Effect<string, QueryCancelled | ItemQueryError>;
    /** Answer a query and report its measurement to `measure`. */
    measure(
      params: CliData,
      measure: QueryMeasure,
    ): Effect.Effect<string, QueryCancelled | ItemQueryError>;
    /** List Collection paths or Tag names through the same worker connection. */
    values(
      params: CliData,
    ): Effect.Effect<string, QueryCancelled | ItemQueryError>;
    /** Answer the shared schema command, optionally narrowed by from. */
    schema(
      params: CliData,
    ): Effect.Effect<string, QueryCancelled | ItemQueryError>;
    /**
     * Run the typed query of a Query View: every row up to `request.limit`,
     * as parsed groups of rows. An invalid query, or a source that cannot
     * answer, gives the diagnostic of `zotlit:query` as data; a job that the
     * layer interrupts gives `cancelled`.
     */
    run(
      request: QueryViewRequest,
    ): Effect.Effect<QueryViewOutcome, ItemQueryError>;
    /**
     * The custom fields of the active Zotero source, by name; none when the
     * job is interrupted first.
     */
    readonly customFieldNames: Effect.Effect<readonly string[], ItemQueryError>;
    /**
     * Request the cancel of the running query named `id`: `false` when no
     * query with this id is running in this vault.
     */
    cancel(id: string): Effect.Effect<boolean>;
    /** The jobs that have not settled. */
    readonly runningJobs: Effect.Effect<number>;
    /**
     * How many typed queries of a Query View the service started. Counted in
     * dev builds alone, for the End-to-end Run; `0` in production.
     */
    readonly viewRuns: Effect.Effect<number>;
    /**
     * Each Use recorded from now on: a change to device Uses invalidates
     * every open Query View.
     */
    readonly changed: Stream.Stream<void>;
  }
>()("zotlit/item-query/QueryService") {}

/**
 * The key of a job that the caller does not name. A query id has no `:`, so
 * this key names no query.
 */
const unnamedKey = (): string => `:${randomUUID()}`;

export function layerQueryService({
  pluginVersion,
}: {
  readonly pluginVersion: string;
}): Layer.Layer<
  QueryService,
  never,
  | ZoteroReads
  | ZoteroPref
  | LibraryScope
  | UseLedger
  | ObsidianEnv
  | FileSystem.FileSystem
> {
  return Layer.effect(
    QueryService,
    Effect.gen(function* () {
      const { reads } = yield* ZoteroReads;
      const pref = yield* ZoteroPref;
      const libraryScope = yield* LibraryScope;
      const useLedger = yield* UseLedger;
      const env = yield* ObsidianEnv;
      const fs = yield* FileSystem.FileSystem;
      const scope = yield* Scope.Scope;
      const jobs = yield* FiberMap.make<string, unknown, ItemQueryError>();
      const runJob = yield* FiberMap.runtime(jobs)();
      let viewRuns = 0;

      /**
       * Fork `job` into the map under `key`. The fiber is uninterruptible
       * outside the waits of the job, so an answer that arrives wins a later
       * cancel.
       */
      const fork = <A>(key: string, job: Effect.Effect<A, ItemQueryError>) =>
        runJob(key, job, { uninterruptible: true });

      /** Fork `job` under a key that names no query. */
      const forkUnnamed = <A>(job: Effect.Effect<A, ItemQueryError>) =>
        Effect.sync(() => fork(unnamedKey(), job));

      /**
       * Fork `job` under `id`, or none when `id` names a running job. The
       * check and the fork are one synchronous step, so two calls with one
       * id cannot both start.
       */
      const claim = <A>(
        job: Effect.Effect<A, ItemQueryError>,
        id: string,
      ): Effect.Effect<Fiber.Fiber<A, ItemQueryError> | undefined> =>
        Effect.sync(() =>
          FiberMap.hasUnsafe(jobs, id) ? undefined : fork(id, job),
        );

      /**
       * Fork a job with `fork` and wait until it settles: its value, or none
       * when it was interrupted; `undefined` when `fork` started no job. No
       * interrupt lands between the fork and the wait, so the job always has
       * an owner; interrupting the caller interrupts the job and waits for it.
       */
      const settle = <A>(
        fork: Effect.Effect<Fiber.Fiber<A, ItemQueryError> | undefined>,
      ): Effect.Effect<Option.Option<A> | undefined, ItemQueryError> =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const fiber = yield* fork;
            if (fiber === undefined) return undefined;
            const exit = yield* awaitOwned(fiber, restore);
            if (Exit.isSuccess(exit)) return Option.some(exit.value);
            if (Cause.hasInterruptsOnly(exit.cause)) return Option.none();
            return yield* Effect.failCause(exit.cause);
          }),
        );

      /**
       * Send one command to the worker and wait for its answer. An interrupt
       * while the worker runs the job sends `CancelItemQuery` and waits for
       * the answer, so the worker closes its writer and ends its borrow
       * before the job ends; a job that the worker cancelled interrupts.
       */
      const send = (
        command: QueryCommand | QueryViewCommand | QueryCustomFieldsCommand,
        {
          id = randomUUID(),
          stagePath,
          measure,
        }: {
          id?: string;
          stagePath?: string | undefined;
          measure?: QueryMeasure | undefined;
        } = {},
      ): Effect.Effect<QueryAnswer, ItemQueryError> =>
        Effect.gen(function* () {
          const report = (phase: CancellationEvent["phase"]) =>
            reportCancel(measure, phase);
          const source = yield* pref.current;
          const call = yield* Effect.forkChild(
            reads
              .ItemQuery({
                job: {
                  id,
                  ...(stagePath ? { stagePath } : {}),
                  ...command,
                  source: {
                    id: source.sourceId,
                    databasePath: source.databasePath,
                  },
                  vault: { name: env.vaultName, path: env.basePath },
                  scope: yield* libraryScope.effective,
                  uses: yield* useLedger.uses,
                  attachmentPaths: {
                    dataDir: source.dataDir,
                    baseAttachmentPath: source.baseAttachmentPath,
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

      /**
       * One CLI job: send the command to the worker and publish its export.
       * The staging file is removed when the job ends.
       */
      const job = (
        command: QueryCommand,
        measure?: QueryMeasure,
      ): Effect.Effect<string, ItemQueryError> =>
        Effect.gen(function* () {
          const id = randomUUID();
          const output = command.schema ? undefined : command.query?.output;
          const stagePath =
            output === undefined
              ? undefined
              : yield* stageExport(fs, output, id);
          const result = yield* send(command, { id, stagePath, measure });
          if (result.view)
            return yield* Effect.die(
              new Error("ZotLit Query answered a CLI command with data."),
            );
          if (stagePath !== undefined && result.receipt.kind === "file")
            return yield* publishExport(fs, {
              stagePath,
              output: result.receipt.path,
              answer: result.answer,
              command: result.command,
            });
          return result.answer;
        }).pipe(
          Effect.scoped,
          Effect.onInterrupt(() => reportCancel(measure, "cleanup-finished")),
          withLogCategory("item-query"),
        );

      /**
       * Run `job` under `id`, or under an unnamed key without one, until it
       * settles. An interrupted job fails with {@link QueryCancelled}; the id
       * of a named job is free once this ends. `command` answers
       * `query-id-in-use` for an id that names a running job.
       */
      const start = Effect.fnUntraced(function* (
        command: QueryCliCommand,
        job: Effect.Effect<string, ItemQueryError>,
        id?: string,
      ) {
        const settled = yield* settle(
          id === undefined ? forkUnnamed(job) : claim(job, id),
        );
        if (settled === undefined)
          return queryIdInUseFailure(id ?? "", command);
        if (Option.isSome(settled)) return settled.value;
        // A job that the closing layer interrupted names the unload.
        return yield* new QueryCancelled({
          message:
            id === undefined || isScopeClosed(scope)
              ? "The query was cancelled."
              : queryCancelledText(id),
        });
      });

      const query = (params: CliData, measure?: QueryMeasure) =>
        Effect.gen(function* () {
          const command = QUERY_COMMAND;
          const request = yield* decodeOrAnswer(command, decodeQuery(params));
          if (Result.isFailure(request)) return request.failure;
          const query = request.success;
          return yield* start(
            command,
            job(
              { schema: false, dataset: query.from, command, query },
              measure,
            ),
            query.id,
          );
        });

      return QueryService.of({
        query: Effect.fn("QueryService.query")((params: CliData) =>
          query(params),
        ),
        measure: Effect.fn("QueryService.measure")(
          (params: CliData, measure: QueryMeasure) => query(params, measure),
        ),
        values: Effect.fn("QueryService.values")(function* (params: CliData) {
          const command = QUERY_VALUES_COMMAND;
          const request = yield* decodeOrAnswer(command, decodeValues(params));
          if (Result.isFailure(request)) return request.failure;
          return yield* start(
            command,
            job({ schema: false, command, values: request.success }),
          );
        }),
        schema: Effect.fn("QueryService.schema")(function* (params: CliData) {
          const command = QUERY_SCHEMA_COMMAND;
          const request = yield* decodeOrAnswer(
            command,
            decodeSchemaArguments(params),
          );
          if (Result.isFailure(request)) return request.failure;
          const { from } = request.success;
          return yield* start(
            command,
            job({
              schema: true,
              ...(from === undefined ? {} : { dataset: from }),
              command,
              pluginVersion,
            }),
          );
        }),
        run: Effect.fn("QueryService.run")(function* (
          request: QueryViewRequest,
        ) {
          if (__DEV__) viewRuns++;
          const command: QueryViewCommand = {
            command: QUERY_COMMAND,
            schema: false,
            view: request,
          };
          const settled = yield* settle(
            forkUnnamed(
              send(command).pipe(
                Effect.flatMap((answer) =>
                  answer.view
                    ? Effect.succeed(answer.view)
                    : Effect.die(
                        new Error(
                          "ZotLit Query answered a typed query with text.",
                        ),
                      ),
                ),
              ),
            ),
          );
          return Option.getOrElse(
            settled ?? Option.none(),
            (): QueryViewOutcome => ({ kind: "cancelled" }),
          );
        }),
        customFieldNames: Effect.gen(function* () {
          const settled = yield* settle(
            forkUnnamed(
              send({
                command: QUERY_SCHEMA_COMMAND,
                schema: false,
                customFields: true,
              }).pipe(Effect.map((answer) => answer.customFields ?? [])),
            ),
          );
          return Option.getOrElse(
            settled ?? Option.none(),
            (): readonly string[] => [],
          );
        }).pipe(Effect.withSpan("QueryService.customFieldNames")),
        cancel: Effect.fn("QueryService.cancel")(function* (id: string) {
          if (!FiberMap.hasUnsafe(jobs, id)) return false;
          yield* Effect.forkIn(FiberMap.remove(jobs, id), scope, {
            startImmediately: true,
          });
          return true;
        }),
        runningJobs: FiberMap.size(jobs).pipe(
          Effect.withSpan("QueryService.runningJobs"),
        ),
        viewRuns: Effect.sync(() => viewRuns).pipe(
          Effect.withSpan("QueryService.viewRuns"),
        ),
        changed: useLedger.changes.pipe(
          Stream.drop(1),
          Stream.map(() => undefined),
        ),
      });
    }).pipe(withLogCategory("item-query")),
  );
}

/**
 * Decode a command's parameters: the request, or the diagnostic envelope of
 * `command` for the parameter that rejects it.
 */
function decodeOrAnswer<A>(
  command: QueryCliCommand,
  decode: Effect.Effect<A, CliRejection>,
): Effect.Effect<Result.Result<A, string>> {
  return decode.pipe(
    Effect.mapError((rejection) =>
      failure(command, rejectionDiagnostic(rejection)),
    ),
    Effect.result,
  );
}

/** Report one phase of a cancel to the measurement, when one observes. */
function reportCancel(
  measure: QueryObserver | undefined,
  phase: CancellationEvent["phase"],
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (measure?.cancelled === undefined) return;
    const atEpochMs = yield* Clock.currentTimeMillis;
    measure.cancelled({ phase, atEpochMs });
  });
}

/** The staging path of an export, beside its output; removed with the job. */
function stageExport(
  fs: FileSystem.FileSystem,
  output: string,
  id: string,
): Effect.Effect<string, never, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.sync(() => join(dirname(output), `.zotlit-query-${id}.tmp`)),
    (stagePath) =>
      fs
        .remove(stagePath, { force: true })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning(
              "ZotLit Query could not remove its temporary export {path}",
            ).pipe(Effect.annotateLogs({ path: stagePath, error })),
          ),
        ),
  );
}

/**
 * Publish the closed staging file at `output`. A file at `output` stays: the
 * answer is then `output-error`, with the system's message.
 */
function publishExport(
  fs: FileSystem.FileSystem,
  {
    stagePath,
    output,
    answer,
    command,
  }: {
    stagePath: string;
    output: string;
    answer: string;
    command: QueryCliCommand;
  },
): Effect.Effect<string> {
  return fs.link(stagePath, output).pipe(
    Effect.as(answer),
    Effect.catchTag("PlatformError", (error) =>
      error.reason._tag === "BadArgument"
        ? Effect.die(error)
        : Effect.succeed(
            failure(command, diagnostic("output-error", systemMessage(error))),
          ),
    ),
  );
}

/** The message of the system call under `error`, as Node wrote it. */
function systemMessage(error: PlatformError): string {
  const cause = error.reason.cause;
  return Error.isError(cause) ? cause.message : error.message;
}
