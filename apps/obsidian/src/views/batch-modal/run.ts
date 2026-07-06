// Shared batch-run and classify scaffolds for modal executors.
import { chunk } from "@std/collections/chunk";
import pLimit from "p-limit";

import { AbortError } from "@/lib/abort-error";
import { formatErrorMessage } from "@/lib/toast";

import {
  type BatchClassifyControls,
  type BatchRunControls,
  type BatchRunResult,
} from "./types";

const CLASSIFY_CHUNK_SIZE = 50;

/**
 * Chunked classify loop: yields between fixed-size slices so the loading bar
 * paints and Cancel stays responsive. The caller's `processSlice` handles the
 * per-id logic; this scaffold owns the progress, abort, and yield plumbing.
 *
 * @throws when {@link BatchClassifyControls.signal} aborts.
 */
export async function classifyChunked(
  ids: readonly number[],
  controls: BatchClassifyControls,
  processSlice: (slice: readonly number[]) => void,
): Promise<void> {
  let classified = 0;
  for (const slice of chunk(ids, CLASSIFY_CHUNK_SIZE)) {
    controls.signal.throwIfAborted();
    processSlice(slice);
    classified += slice.length;
    controls.onProgress(classified);
    await sleep(0);
  }
}

export interface BatchRunTask {
  id: number;
  label: string;
}

/** Write outcome returned by a task's `run` callback; field names match
 * {@link BatchRunResult} so the scaffold can tally directly. */
export type RunOutcome = "created" | "updated" | "skipped";

/**
 * Concurrent pLimit + allSettled executor that owns the abort/settle/error
 * contract between a modal's `onRun` callback and its shell. Each task returns
 * a {@link RunOutcome} (tallied into {@link BatchRunResult} and reported via
 * {@link BatchRunControls.onItemSettled}) or throws (reported as `"failed"`
 * with a formatted error message). Abort errors are suppressed from the
 * failure count; cancelled tasks are those that never ran.
 *
 * @param opts.onTaskFailed Optional per-failure callback (non-abort only),
 *   called after the task is reported as failed; use for structured logging.
 */
export async function executeBatchRun<T extends BatchRunTask>(opts: {
  tasks: readonly T[];
  controls: BatchRunControls;
  concurrency: number;
  run: (task: T) => Promise<RunOutcome>;
  onTaskFailed?: (task: T, error: unknown) => void;
}): Promise<BatchRunResult> {
  const { tasks, controls, concurrency, run, onTaskFailed } = opts;
  const limit = pLimit(concurrency);
  const result: BatchRunResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    cancelled: false,
  };
  const settled = await Promise.allSettled(
    tasks.map((task) =>
      limit(async () => {
        controls.signal.throwIfAborted();
        try {
          const outcome = await run(task);
          result[outcome] += 1;
          const status: "done" | "skipped" =
            outcome === "skipped" ? "skipped" : "done";
          controls.onItemSettled({ id: task.id, status });
        } catch (error) {
          if (!AbortError.test(error)) {
            controls.onItemSettled({
              id: task.id,
              status: "failed",
              failure: {
                label: task.label,
                message: formatErrorMessage(error),
              },
            });
          }
          throw error;
        }
      }),
    ),
  );

  let completed = 0;
  for (const [i, entry] of settled.entries()) {
    if (entry.status === "fulfilled") {
      completed += 1;
    } else if (!AbortError.test(entry.reason)) {
      result.failed += 1;
      completed += 1;
      onTaskFailed?.(tasks[i]!, entry.reason);
    }
  }
  result.cancelled = controls.signal.aborted && completed < tasks.length;
  return result;
}
