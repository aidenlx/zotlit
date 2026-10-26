// Concurrent classify/execute primitives for batch runs, and the Promise edge the batch modal calls.
import { Cause, Deferred, Effect, Exit, Ref, Stream } from "effect";
import type { Context } from "effect";

import { AbortError } from "@/lib/abort-error";
import { settleAtEdge } from "@/lib/signal-edge";
import { formatErrorMessage } from "@/lib/toast";

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
  /** The modal's cancel; a Promise caller turns it into an interrupt with
   * {@link runBatch}. */
  signal: AbortSignal;
}

export interface BatchRunControls {
  /** Reports a single row reaching a terminal state. The shell owns the running
   * counts and flips the row in place; queued work a stop skips never settles. */
  onItemSettled: (
    event:
      | { id: number; status: "done" }
      | { id: number; status: "skipped" }
      | { id: number; status: "failed"; failure: BatchFailure },
  ) => void;
  /**
   * The run's stop request, completed by the modal's cancel or dismissal. Once
   * it is done, queued tasks never start and admitted tasks finish; the run
   * still returns its {@link BatchRunResult}, with `cancelled` set when tasks
   * were left.
   */
  stop: Deferred.Deferred<void>;
}

/**
 * A new stop request for {@link BatchRunControls.stop}, for a plain caller (the
 * batch modal): `request` completes it, and a second call does nothing.
 */
export function makeStopRequest(): {
  stop: BatchRunControls["stop"];
  request: () => void;
} {
  const stop = Deferred.makeUnsafe<void>();
  return {
    stop,
    request: () => {
      Deferred.doneUnsafe(stop, Exit.void);
    },
  };
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
 * Classify ids through sequential requests of at most 500 ids. `read` uses
 * the caller's Snapshot so every request sees one database state. Each reply
 * slice advances the loading bar, and the caller's `processSlice` handles the
 * per-id logic. It cancels by interruption only: a Promise caller passes
 * {@link BatchClassifyControls.signal} to {@link runBatch}, which interrupts it.
 *
 * @returns an Effect that fails with a read error.
 */
export function classifyStream<A, E>(
  {
    itemIDs,
    read,
  }: {
    itemIDs: readonly number[];
    read: (itemIDs: readonly number[]) => Stream.Stream<readonly A[], E>;
  },
  controls: Pick<BatchClassifyControls, "onProgress">,
  processSlice: (slice: readonly A[]) => void,
): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    function* requests() {
      for (let start = 0; start < itemIDs.length; start += 500) {
        yield itemIDs.slice(start, start + 500);
      }
    }
    // Bound request encoding and structured cloning on the renderer as well
    // as the worker's reply slices. Pull one request only after the last ends.
    const slices = Stream.fromIterable(requests(), { chunkSize: 1 }).pipe(
      Stream.flatMap((ids) => read(ids)),
    );
    let classified = 0;
    yield* Stream.runForEach(slices, (slice) =>
      Effect.sync(() => {
        processSlice(slice);
        classified += slice.length;
        controls.onProgress(classified);
      }),
    );
  });
}

export interface BatchRunTask {
  id: number;
  label: string;
}

/** Write outcome returned by a task's `run` callback; field names match
 * {@link BatchRunResult} so the scaffold can tally directly. */
export type RunOutcome = "created" | "updated" | "skipped";

/**
 * Concurrent Effect executor that owns the stop/settle/error contract between
 * a modal's `onRun` callback and its shell. Each task returns a
 * {@link RunOutcome} (tallied into {@link BatchRunResult} and reported via
 * {@link BatchRunControls.onItemSettled}) or fails (reported as `"failed"` with
 * a formatted error message). Abort errors are suppressed from the failure
 * count; cancelled tasks are those that never ran, and a stop request
 * interrupts task scheduling rather than producing a typed failure.
 *
 * The executor polls {@link BatchRunControls.stop} as each task starts: a stop
 * skips queued tasks and leaves admitted work running to its own completion.
 *
 * @param opts.onTaskFailed Optional per-failure callback (non-abort only),
 *   called after the task is reported as failed; use for structured logging.
 * @param opts.haltOn Marks an error as configuration-level rather than
 *   per-item: the first task to fail with a matching error halts the whole run
 *   instead of reporting a failure row (and repeating the same message for
 *   every remaining item). Tasks that haven't started yet short-circuit once
 *   the halt is recorded; the Effect fails with that error once all in-flight
 *   tasks settle.
 *
 * @returns an Effect that fails with a task error or the first halting error.
 */
export function executeBatchRun<T extends BatchRunTask, E>(opts: {
  tasks: readonly T[];
  controls: BatchRunControls;
  concurrency: number;
  run: (task: T) => Effect.Effect<RunOutcome, E>;
  onTaskFailed?: (task: T, error: unknown) => void;
  haltOn?: (error: unknown) => boolean;
}): Effect.Effect<BatchRunResult, E> {
  const { tasks, controls, concurrency, run, onTaskFailed, haltOn } = opts;

  return Effect.gen(function* () {
    const result = yield* Ref.make<BatchRunResult>({
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      cancelled: false,
    });
    const halt = yield* Ref.make<Cause.Cause<E> | null>(null);
    const settled = yield* Effect.forEach(
      tasks,
      (task) =>
        Effect.exit(
          Effect.uninterruptible(
            Effect.gen(function* () {
              if (yield* Deferred.isDone(controls.stop))
                return yield* Effect.interrupt;
              if ((yield* Ref.get(halt)) !== null)
                return yield* Effect.interrupt;
              const exit = yield* Effect.exit(run(task));
              if (Exit.isFailure(exit)) {
                const error = Cause.squash(exit.cause);
                if (haltOn?.(error)) {
                  yield* Ref.update(halt, (current) => current ?? exit.cause);
                  return yield* Effect.interrupt;
                }
                if (!AbortError.test(error)) {
                  const recovery = profileRecovery(error);
                  yield* Effect.sync(() =>
                    controls.onItemSettled({
                      id: task.id,
                      status: "failed",
                      failure: {
                        label: task.label,
                        message: formatErrorMessage(error),
                        ...(recovery ? { recovery } : {}),
                      },
                    }),
                  );
                }
                return yield* Effect.failCause(exit.cause);
              }

              const outcome = exit.value;
              yield* Ref.update(result, (current) => ({
                ...current,
                [outcome]: current[outcome] + 1,
              }));
              const status: "done" | "skipped" =
                outcome === "skipped" ? "skipped" : "done";
              yield* Effect.sync(() =>
                controls.onItemSettled({ id: task.id, status }),
              );
            }),
          ),
        ),
      { concurrency },
    );

    let completed = 0;
    for (const [i, entry] of settled.entries()) {
      if (Exit.isSuccess(entry)) {
        completed += 1;
      } else if (!Cause.hasInterruptsOnly(entry.cause)) {
        const error = Cause.squash(entry.cause);
        if (!AbortError.test(error)) {
          yield* Ref.update(result, (current) => ({
            ...current,
            failed: current.failed + 1,
          }));
          completed += 1;
          onTaskFailed?.(tasks[i]!, error);
        }
      }
    }

    const halted = yield* Ref.get(halt);
    if (halted !== null) return yield* Effect.failCause(halted);
    const stopped = yield* Deferred.isDone(controls.stop);
    yield* Ref.update(result, (current) => ({
      ...current,
      cancelled: stopped && completed < tasks.length,
    }));
    return yield* Ref.get(result);
  });
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
 * Run an Effect-native batch operation from a Promise caller. This is the
 * caller boundary: typed failures and defects keep their identity, and an
 * aborted signal rejects with the signal's own abort reason.
 */
export async function runBatch<A, E>(
  effect: Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  signal?.throwIfAborted();
  // Every Effect here has R = never, so the default Effect runtime is enough.
  const exit = await Effect.runPromiseExit(
    effect,
    signal === undefined ? undefined : { signal },
  );
  return settleAtEdge(exit, signal);
}

/**
 * {@link runBatch} over the services of `context`: a modal callback runs a
 * batch operation that reads service tags. It settles as {@link runBatch}
 * settles.
 */
export function runBatchWith<R>(context: Context.Context<R>) {
  const run = Effect.runPromiseExitWith(context);
  return async <A, E>(
    effect: Effect.Effect<A, E, R>,
    signal?: AbortSignal,
  ): Promise<A> => {
    signal?.throwIfAborted();
    const exit = await run(
      effect,
      signal === undefined ? undefined : { signal },
    );
    return settleAtEdge(exit, signal);
  };
}
