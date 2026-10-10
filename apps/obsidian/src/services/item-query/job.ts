// One Query Job inside the ZoteroReads worker, on its borrowed connection: one
// Effect on the fiber of the job, with the time-budget scheduler and the
// database of the job. Interruption of that fiber is the cancel of the job.
import { Effect, Scheduler } from "effect";
import type { Scope } from "effect";
import { open } from "node:fs/promises";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { ItemQueryDatabase } from "@zotlit/db/item-query";
import { ItemQueryScheduler } from "@zotlit/item-query";
import type { ResolveAttachmentFile } from "@zotlit/item-query";

import type { WorkbenchIdentity } from "@/services/template-workbench/envelope";

import { answer, QueryOutputError } from "./answer";
import type { QueryWriter } from "./answer";
import { diagnostic, failure } from "./contract";
import { createTrace, finishTrace } from "./trace";
import type { WorkerMeasurement } from "./trace";
import type { QueryAnswer, QueryJob } from "./worker-protocol";

/** The connection of one Query Job and the identity its envelope reports. */
export interface QueryJobEnv {
  client: NodeDatabaseClient;
  identity: WorkbenchIdentity;
  attachmentFiles: ResolveAttachmentFile;
}

/**
 * Run one Query Job to its answer. The staging file of an export closes in the
 * scope of the job, before the returned Effect ends, so it closes before the
 * caller ends its borrow of the connection. A failed close makes the answer
 * `output-error`: the file is then not a complete export. Interruption cancels
 * the job.
 */
export function runQueryJob(
  job: QueryJob,
  env: QueryJobEnv,
): Effect.Effect<QueryAnswer> {
  const stage: StageState = {};
  return Effect.gen(function* () {
    const startedAt = performance.timeOrigin + performance.now();
    const trace = job.measure ? createTrace(job.heap ?? false) : undefined;
    const answerSteps: number[] = [];
    const heapBefore = job.heap ? process.memoryUsage().heapUsed : undefined;
    const reply = yield* answer(job, {
      identity: env.identity,
      attachmentFiles: env.attachmentFiles,
      instrument: trace?.instrument,
      onAnswerStep: job.measure
        ? (ms: number) => answerSteps.push(ms)
        : undefined,
      openOutput: () => openStage(job.stagePath, stage),
    });
    if (!trace) return reply;
    return {
      ...reply,
      measurement: JSON.parse(
        JSON.stringify(
          finishTrace(trace, { startedAt, answerSteps, heapBefore }),
        ),
      ) as WorkerMeasurement,
    };
  }).pipe(
    Effect.scoped,
    Effect.flatMap((answer) => {
      const { closeError } = stage;
      if (closeError === undefined) return Effect.succeed(answer);
      return fileStep(() => Promise.reject(closeError)).pipe(
        Effect.as(answer),
        Effect.catch((failed) =>
          Effect.succeed<QueryAnswer>({
            command: job.command,
            answer: failure(job.command, failed.diagnostic),
            receipt: { kind: "inline" },
          }),
        ),
      );
    }),
    Effect.provideService(ItemQueryDatabase, { client: env.client }),
    Effect.provideService(Scheduler.Scheduler, new ItemQueryScheduler()),
  );
}

/** The close of the staging file, which the release of the writer records. */
interface StageState {
  closeError?: unknown;
}

/**
 * Open the staging file of the job in its scope. Only the write of one chunk is
 * uninterruptible: native I/O settles before the scope closes the file. The
 * release records a failed close in `stage`.
 */
function openStage(
  stagePath: string | undefined,
  stage: StageState,
): Effect.Effect<QueryWriter, QueryOutputError, Scope.Scope> {
  if (stagePath === undefined)
    return Effect.die(new Error("Item Query export has no staging path"));
  return Effect.acquireRelease(
    fileStep(() => open(stagePath, "wx", 0o600)),
    (file) =>
      Effect.promise(() =>
        file.close().catch((error: unknown) => {
          stage.closeError = error;
        }),
      ),
  ).pipe(
    Effect.map((file) => ({
      write: (text: string) =>
        fileStep(() => file.writeFile(text, "utf8")).pipe(
          Effect.uninterruptible,
        ),
    })),
  );
}

/** A file operation: a system error is the `output-error` of the envelope. */
function fileStep<A>(
  step: () => Promise<A>,
): Effect.Effect<A, QueryOutputError> {
  return Effect.tryPromise({ try: step, catch: (error) => error }).pipe(
    Effect.catch((error) =>
      error instanceof Error && "code" in error
        ? Effect.fail(
            new QueryOutputError({
              diagnostic: diagnostic("output-error", error.message),
            }),
          )
        : Effect.die(error),
    ),
  );
}
