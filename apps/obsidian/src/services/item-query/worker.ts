// Item Query execution inside the ZoteroReads worker, on its borrowed connection.
import { Effect } from "effect";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import {
  createItemQueryHandler,
  createItemQuerySchemaHandler,
  diagnostic,
  failure,
  ITEM_QUERY_COMMAND,
} from "./cli";
import { withQueryOutput } from "./export";
import { createTrace, finishTrace } from "./trace";
import type { WorkerMeasurement } from "./trace";
import type { QueryJob } from "./worker-protocol";

export interface QueryAnswer {
  answer: string;
  cancelled?: boolean;
  measurement?: WorkerMeasurement;
}

/** RPC interruption also waits for the writer before its database borrow ends. */
export const answerItemQuery = (
  job: QueryJob,
  client: NodeDatabaseClient,
  controller: AbortController,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      let settled = false;
      const pending = answer(job, client, controller.signal)
        .catch((error: unknown) => {
          if (controller.signal.aborted) return { answer: "", cancelled: true };
          throw error;
        })
        .finally(() => {
          settled = true;
        });
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          if (!settled) controller.abort();
          await pending.catch(() => {});
        }),
      );
      return yield* Effect.promise(() => pending);
    }),
  );

async function answer(
  job: QueryJob,
  client: NodeDatabaseClient,
  signal: AbortSignal,
): Promise<QueryAnswer> {
  const startedAt = performance.timeOrigin + performance.now();
  const trace = job.measure ? createTrace(job.heap ?? false) : undefined;
  const answerSteps: number[] = [];
  const heapBefore = job.heap ? process.memoryUsage().heapUsed : undefined;
  try {
    return await withQueryOutput(job.stagePath, async (openOutput) => {
      const deps = {
        client,
        identity: { vault: job.vault, source: job.source },
        libraryScope: async () => job.scope,
        signal,
        instrument: trace?.instrument,
        onAnswerStep: job.measure
          ? (ms: number) => answerSteps.push(ms)
          : undefined,
        openOutput,
      };
      const text = job.schema
        ? await createItemQuerySchemaHandler(deps)()
        : await createItemQueryHandler(deps)(job.query);
      signal.throwIfAborted();
      return {
        answer: text,
        ...(trace
          ? {
              measurement: JSON.parse(
                JSON.stringify(
                  finishTrace(trace, { startedAt, answerSteps, heapBefore }),
                ),
              ) as WorkerMeasurement,
            }
          : {}),
      };
    });
  } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof Error) || !("code" in error)) throw error;
    return {
      answer: failure(
        ITEM_QUERY_COMMAND,
        diagnostic("output-error", error.message),
      ),
    };
  }
}
