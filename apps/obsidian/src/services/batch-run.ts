// Snapshot-pinned batch write runner over the concurrent classify/execute primitives.
import { Effect, Stream } from "effect";
import PQueue from "p-queue";

import { AbortError } from "@/lib/abort-error";
import { formatErrorMessage } from "@/lib/toast";
import type {
  ZoteroReadsApi,
  ZoteroReadsService,
} from "@/services/zotero-reads/service";

/** A failed-item payload the run reports; rendered by the modal's failure row. */
export interface BatchFailure {
  label: string;
  message: string;
  recovery?: { action: "switch-profile"; path: string };
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

/**
 * Classify loop over a stream of slices, one entry per classified id: each
 * slice advances the loading bar. An abort of
 * {@link BatchClassifyControls.signal} interrupts the stream, so no read runs
 * after the slice in progress. The caller's `processSlice` handles the per-id
 * logic; this scaffold owns the progress and abort plumbing.
 *
 * @throws when {@link BatchClassifyControls.signal} aborts or a read fails.
 */
export async function classifyStream<A, E>(
  slices: Stream.Stream<readonly A[], E>,
  controls: BatchClassifyControls,
  processSlice: (slice: readonly A[]) => void,
): Promise<void> {
  // A run started on an already-aborted signal completes, so check first.
  controls.signal.throwIfAborted();
  let classified = 0;
  await Effect.runPromise(
    Stream.runForEach(slices, (slice) =>
      // Slices can arrive synchronously, before the run hears the abort; each
      // slice checks the signal so an abort interrupts at the next slice.
      controls.signal.aborted
        ? Effect.interrupt
        : Effect.sync(() => {
            processSlice(slice);
            classified += slice.length;
            controls.onProgress(classified);
          }),
    ),
    { signal: controls.signal },
  );
}

export interface BatchRunTask {
  id: number;
  label: string;
}

/** Write outcome returned by a task's `run` callback; field names match
 * {@link BatchRunResult} so the scaffold can tally directly. */
export type RunOutcome = "created" | "updated" | "skipped";

/**
 * Concurrent PQueue + allSettled executor that owns the abort/settle/error
 * contract between a modal's `onRun` callback and its shell. Each task returns
 * a {@link RunOutcome} (tallied into {@link BatchRunResult} and reported via
 * {@link BatchRunControls.onItemSettled}) or throws (reported as `"failed"`
 * with a formatted error message). Abort errors are suppressed from the
 * failure count; cancelled tasks are those that never ran.
 *
 * The queue never takes the caller's signal: cancellation stops queued tasks
 * when they start and leaves admitted work running to its own completion.
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
  const queue = new PQueue({ concurrency });
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
      queue.add(async () => {
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
            const recovery = profileRecovery(error);
            controls.onItemSettled({
              id: task.id,
              status: "failed",
              failure: {
                label: task.label,
                message: formatErrorMessage(error),
                ...(recovery ? { recovery } : {}),
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

/** Preserve only actionable diagnostic data across the generic failure boundary. */
function profileRecovery(error: unknown): BatchFailure["recovery"] {
  if (!Error.isError(error) || !("diagnostic" in error)) return undefined;
  const diagnostic = error.diagnostic;
  if (
    typeof diagnostic !== "object" ||
    diagnostic === null ||
    !("code" in diagnostic) ||
    diagnostic.code !== "unknown-literature-note-profile" ||
    !("path" in diagnostic) ||
    typeof diagnostic.path !== "string" ||
    !diagnostic.path
  )
    return undefined;
  return { action: "switch-profile", path: diagnostic.path };
}

/**
 * Run a batch of write tasks under one ZoteroReads Snapshot held for the whole
 * run, so every task's `run` reads one database state even when a refresh
 * lands mid-run. The lease is released on success, failure, and abort alike
 * (scope-bound `using`). Callers create their per-run caches before this call
 * and close over them in `run`; the Snapshot-bound `reads` is threaded to each
 * task.
 *
 * @throws when no Snapshot can be opened (no lease acquired).
 */
export async function runBatchWrite<T extends BatchRunTask>(opts: {
  zoteroReads: Pick<ZoteroReadsService, "acquireRead">;
  tasks: readonly T[];
  controls: BatchRunControls;
  concurrency: number;
  run: (task: T, reads: ZoteroReadsApi) => Promise<RunOutcome>;
  onTaskFailed?: (task: T, error: unknown) => void;
  haltOn?: (error: unknown) => boolean;
}): Promise<BatchRunResult> {
  await using lease = await opts.zoteroReads.acquireRead();
  // Awaited inside the `using` scope so the lease stays pinned until every task
  // settles; returning the pending promise would dispose the lease early.
  const result = await executeBatchRun({
    tasks: opts.tasks,
    controls: opts.controls,
    concurrency: opts.concurrency,
    run: (task) => opts.run(task, lease.reads),
    onTaskFailed: opts.onTaskFailed,
    haltOn: opts.haltOn,
  });
  return result;
}
