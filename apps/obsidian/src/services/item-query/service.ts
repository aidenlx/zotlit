import { Cause, Effect, Exit, Fiber, FiberMap, Scope } from "effect";
import { randomUUID } from "node:crypto";
import { link, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CliData, FileSystemAdapter, Vault } from "obsidian";

import { openScope } from "@/lib/effect-scope";
import { getLogger } from "@/lib/log";
import type { LibraryScopeService } from "@/services/library-scope/service";
import { Service } from "@/services/service-base";
import type { ZoteroPrefService } from "@/services/zotero-pref/service";
import type { ZoteroReadsService } from "@/services/zotero-reads/service";

import {
  diagnostic,
  failure,
  ITEM_QUERY_COMMAND,
  ITEM_QUERY_SCHEMA_COMMAND,
  queryIdInUseFailure,
} from "./cli";
import {
  ANNOTATION_QUERY_COMMAND,
  ANNOTATION_QUERY_SCHEMA_COMMAND,
  queryCancelledText,
} from "./contract";
import {
  decodeAnnotationQuery,
  decodeItemQuery,
  decodeSchemaArguments,
  rejectionDiagnostic,
} from "./decode";
import type { CancellationEvent, QueryObserver } from "./trace";
import type { QueryAnswer, QueryCommand } from "./worker-protocol";

interface ItemQueryServiceDeps {
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
  job: Effect.Effect<string, unknown>,
  options: Effect.RunOptions,
) => Fiber.Fiber<string, unknown>;

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
export class ItemQueryService extends Service {
  readonly #deps;
  #jobs!: FiberMap.FiberMap<string, string>;
  #run!: JobRunner;
  /** The failure of startup: every job then rejects with it. */
  #startup: { failed: true; error: unknown } | undefined;
  ready: Promise<void>;

  constructor(deps: ItemQueryServiceDeps) {
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
      Scope.provide(FiberMap.make<string, string>(), scope),
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

  annotations(params: CliData, signal: AbortSignal): Promise<string> {
    return this.#answer(params, signal, { annotations: true });
  }

  answer(
    params: CliData,
    signal: AbortSignal,
    measure?: QueryObserver & { heap: boolean },
  ): Promise<string> {
    return this.#answer(params, signal, { measure });
  }

  #answer(
    params: CliData,
    signal: AbortSignal,
    {
      annotations = false,
      measure,
    }: { annotations?: boolean; measure?: QueryObserver & { heap: boolean } },
  ): Promise<string> {
    // Decode and claim the id synchronously, so two calls with one id
    // cannot both start. The worker receives the decoded query.
    const command = annotations ? ANNOTATION_QUERY_COMMAND : ITEM_QUERY_COMMAND;
    const request = annotations
      ? decodeAnnotationQuery(params)
      : decodeItemQuery(params);
    if (request.kind === "invalid") {
      return Promise.resolve(failure(command, rejectionDiagnostic(request)));
    }
    const query = request.value;
    const { id } = query;
    if (id !== undefined && FiberMap.hasUnsafe(this.#jobs, id)) {
      return Promise.resolve(queryIdInUseFailure(id, command));
    }
    return this.#start(
      this.#job({ schema: false, query }, measure),
      signal,
      id,
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

  schema(
    params: CliData,
    signal: AbortSignal,
    kind?: "annotations",
  ): Promise<string> {
    const rejected = decodeSchemaArguments(params);
    if (rejected.kind === "invalid") {
      return Promise.resolve(
        failure(
          kind === "annotations"
            ? ANNOTATION_QUERY_SCHEMA_COMMAND
            : ITEM_QUERY_SCHEMA_COMMAND,
          rejectionDiagnostic(rejected),
        ),
      );
    }
    return this.#start(
      this.#job({
        schema: true,
        pluginVersion: this.#deps.pluginVersion,
        ...(kind ? { kind } : {}),
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
    const fiber = this.#run(id ?? unnamedKey(), job, {
      signal,
      uninterruptible: true,
    });
    return Effect.runPromise(Fiber.await(fiber)).then((exit) => {
      if (Exit.isSuccess(exit)) return exit.value;
      if (!Cause.hasInterruptsOnly(exit.cause)) throw Cause.squash(exit.cause);
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
   * One job: send the command to the worker and publish its export. An
   * interrupt while the worker runs the job sends `CancelItemQuery` and waits
   * for the answer, so the worker closes its writer and ends its borrow
   * before the job ends. The staging file is removed when the job ends.
   */
  #job(
    command: QueryCommand,
    measure?: QueryObserver & { heap: boolean },
  ): Effect.Effect<string, unknown> {
    const deps = this.#deps;
    const ready = this.ready;
    const report = (phase: CancellationEvent["phase"]) =>
      Effect.sync(() =>
        measure?.cancelled?.({
          phase,
          atEpochMs: Temporal.Now.instant().epochMilliseconds,
        }),
      );
    return Effect.gen(function* () {
      const reads = yield* Effect.interruptible(
        Effect.promise(async () => {
          await ready;
          return (await deps.reads.ready).reads;
        }),
      ).pipe(Effect.onInterrupt(() => report("requested")));
      const id = randomUUID();
      const output = command.schema ? undefined : command.query.output;
      const stagePath =
        output === undefined ? undefined : yield* stageExport(output, id);
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
            Effect.catchTag("DbUnavailable", (error) =>
              Effect.succeed<QueryAnswer>({
                answer: failure(
                  command.schema
                    ? command.kind === "annotations"
                      ? ANNOTATION_QUERY_SCHEMA_COMMAND
                      : ITEM_QUERY_SCHEMA_COMMAND
                    : command.query.kind === "annotations"
                      ? ANNOTATION_QUERY_COMMAND
                      : ITEM_QUERY_COMMAND,
                  diagnostic("source-unavailable", error.message),
                ),
                receipt: { kind: "inline" },
              }),
            ),
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
      if (stagePath !== undefined && result.receipt.kind === "file")
        return yield* publishExport({
          stagePath,
          output: result.receipt.path,
          answer: result.answer,
          command:
            !command.schema && command.query.kind === "annotations"
              ? ANNOTATION_QUERY_COMMAND
              : ITEM_QUERY_COMMAND,
        });
      return result.answer;
    }).pipe(
      Effect.scoped,
      Effect.onInterrupt(() => report("cleanup-finished")),
    );
  }
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
            "Item Query could not remove its temporary export {path}",
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
  command: typeof ITEM_QUERY_COMMAND | typeof ANNOTATION_QUERY_COMMAND;
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
