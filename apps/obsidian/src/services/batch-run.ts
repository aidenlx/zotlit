// Lease-pinned batch write runner over the concurrent classify/execute primitives.
import { chunk } from "@std/collections/chunk";
import pLimit from "p-limit";

import { type NodeDatabaseClient } from "@zotlit/db/client/node";

import { AbortError } from "@/lib/abort-error";
import { yieldToMain } from "@/lib/yield-to-main";
import { formatErrorMessage } from "@/lib/toast";
import { type DatabaseService } from "@/services/database/service";

/** A failed-item payload the run reports; rendered by the modal's failure row. */
export interface BatchFailure {
  label: string;
  message: string;
}

export interface BatchClassifyControls {
  /** Reports how many ids have been classified, driving the loading bar against
   * the total passed at construction. */
  onProgress: (classified: number) => void;
  signal: AbortSignal;
}

export interface BatchRunControls {
  /** Reports a single row reaching a terminal state. The shell owns the running
   * counts and flips the row in place; aborted queued work never settles. */
  onItemSettled: (
    event:
      | { id: number; status: "done" }
      | { id: number; status: "skipped" }
      | { id: number; status: "failed"; failure: BatchFailure },
  ) => void;
  signal: AbortSignal;
}

export interface BatchRunResult {
  created: number;
  updated: number;
  /** Rows that settled without writing (e.g. an import whose file already
   * existed). `0` for operations with no skip path, like batch update. */
  skipped: number;
  failed: number;
  cancelled: boolean;
}

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
    await yieldToMain();
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
 * @param opts.haltOn Marks an error as configuration-level rather than
 *   per-item: the first task to throw a matching error aborts the whole run
 *   instead of reporting a failure row (and repeating the same message for
 *   every remaining item). Tasks that haven't started yet short-circuit once
 *   the halt is recorded; the run rejects with that error once all in-flight
 *   tasks settle.
 */
export async function executeBatchRun<T extends BatchRunTask>(opts: {
  tasks: readonly T[];
  controls: BatchRunControls;
  concurrency: number;
  run: (task: T) => Promise<RunOutcome>;
  onTaskFailed?: (task: T, error: unknown) => void;
  haltOn?: (error: unknown) => boolean;
}): Promise<BatchRunResult> {
  const { tasks, controls, concurrency, run, onTaskFailed, haltOn } = opts;
  const limit = pLimit(concurrency);
  const result: BatchRunResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    cancelled: false,
  };
  let haltError: unknown;
  const settled = await Promise.allSettled(
    tasks.map((task) =>
      limit(async () => {
        controls.signal.throwIfAborted();
        if (haltError !== undefined) throw new AbortError("halted");
        try {
          const outcome = await run(task);
          result[outcome] += 1;
          const status: "done" | "skipped" =
            outcome === "skipped" ? "skipped" : "done";
          controls.onItemSettled({ id: task.id, status });
        } catch (error) {
          if (haltOn?.(error)) {
            haltError ??= error;
            throw new AbortError("halted");
          }
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
  if (haltError !== undefined) throw haltError;
  result.cancelled = controls.signal.aborted && completed < tasks.length;
  return result;
}

/**
 * Run a batch of write tasks under a single database read lease held for the
 * whole run, so every task's `run` sees one pinned client snapshot instead of a
 * client a refresh swap could close mid-run. The lease is released on success,
 * failure, and abort alike (scope-bound `using`). Callers create their per-run
 * memoized fetch caches before this call and close over them in `run`; the
 * pinned `client` is threaded to each task.
 *
 * @throws {@link DatabaseError} when the service is degraded (no lease acquired).
 */
export async function runBatchWrite<T extends BatchRunTask>(opts: {
  db: Pick<DatabaseService, "acquireRead">;
  tasks: readonly T[];
  controls: BatchRunControls;
  concurrency: number;
  run: (task: T, client: NodeDatabaseClient) => Promise<RunOutcome>;
  onTaskFailed?: (task: T, error: unknown) => void;
  haltOn?: (error: unknown) => boolean;
}): Promise<BatchRunResult> {
  using lease = await opts.db.acquireRead();
  // Awaited inside the `using` scope so the lease stays pinned until every task
  // settles; returning the pending promise would dispose the lease early.
  const result = await executeBatchRun({
    tasks: opts.tasks,
    controls: opts.controls,
    concurrency: opts.concurrency,
    run: (task) => opts.run(task, lease.client),
    onTaskFailed: opts.onTaskFailed,
    haltOn: opts.haltOn,
  });
  return result;
}
