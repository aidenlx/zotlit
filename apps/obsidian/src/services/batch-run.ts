import { AbortError } from "@/lib/abort-error";
// Snapshot-pinned batch write runner over the concurrent classify/execute primitives.
import { Cause, Effect, Exit, Ref, Stream } from "@/lib/effect";
import { formatErrorMessage } from "@/lib/toast";
import type {
  ZoteroReads,
  ZoteroReadsApi,
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
 * Classify ids through sequential requests of at most 500 ids. `read` uses
 * the caller's Snapshot so every request sees one database state. Each reply
 * slice advances the loading bar, and the caller's `processSlice` handles the
 * per-id logic. An abort of {@link BatchClassifyControls.signal} interrupts
 * the Effect; it is not a typed failure.
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
  controls: BatchClassifyControls,
  processSlice: (slice: readonly A[]) => void,
): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    // A run started on an already-aborted signal completes, so check first.
    yield* Effect.sync(() => controls.signal.throwIfAborted());
    function* requests() {
      for (let start = 0; start < itemIDs.length; start += 500) {
        yield itemIDs.slice(start, start + 500);
      }
    }
    // Bound request encoding and structured cloning on the renderer as well
    // as the worker's reply slices. Pull one request only after the last ends.
    const slices = Stream.fromIterable(requests(), { chunkSize: 1 }).pipe(
      Stream.flatMap((ids) =>
        controls.signal.aborted
          ? Stream.fromEffect(Effect.interrupt)
          : read(ids),
      ),
    );
    let classified = 0;
    yield* Stream.runForEach(slices, (slice) =>
      // Slices can arrive synchronously, before the run hears the abort; each
      // slice checks the signal so an abort interrupts at the next slice.
      controls.signal.aborted
        ? Effect.interrupt
        : Effect.sync(() => {
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
 * Concurrent Effect executor that owns the abort/settle/error contract between
 * a modal's `onRun` callback and its shell. Each task returns a
 * {@link RunOutcome} (tallied into {@link BatchRunResult} and reported via
 * {@link BatchRunControls.onItemSettled}) or fails (reported as `"failed"` with
 * a formatted error message). Abort errors are suppressed from the failure
 * count; cancelled tasks are those that never ran, and an abort interrupts
 * task scheduling rather than producing a typed failure.
 *
 * The executor never takes the caller's signal: cancellation stops queued tasks
 * when they start and leaves admitted work running to its own completion.
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
export function executeBatchRun<T extends BatchRunTask>(opts: {
  tasks: readonly T[];
  controls: BatchRunControls;
  concurrency: number;
  run: (task: T) => Effect.Effect<RunOutcome, unknown>;
  onTaskFailed?: (task: T, error: unknown) => void;
  haltOn?: (error: unknown) => boolean;
}): Effect.Effect<BatchRunResult, unknown> {
  const { tasks, controls, concurrency, run, onTaskFailed, haltOn } = opts;

  return Effect.gen(function* () {
    const result = yield* Ref.make<BatchRunResult>({
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      cancelled: false,
    });
    const halt = yield* Ref.make<{
      halted: boolean;
      error: unknown;
    }>({ halted: false, error: undefined });
    const settled = yield* Effect.forEach(
      tasks,
      (task) =>
        Effect.exit(
          Effect.uninterruptible(
            Effect.gen(function* () {
              if (controls.signal.aborted) return yield* Effect.interrupt;
              if ((yield* Ref.get(halt)).halted) return yield* Effect.interrupt;
              const exit = yield* Effect.exit(run(task));
              if (Exit.isFailure(exit)) {
                const error = Cause.squash(exit.cause);
                if (haltOn?.(error)) {
                  yield* Ref.update(halt, (current) =>
                    current.halted ? current : { halted: true, error },
                  );
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
                return yield* Effect.fail(error);
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
    if (halted.halted) return yield* Effect.fail(halted.error);
    yield* Ref.update(result, (current) => ({
      ...current,
      cancelled: controls.signal.aborted && completed < tasks.length,
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
 * Run a batch of write tasks under one ZoteroReads Snapshot held for the whole
 * run, so every task's `run` reads one database state even when a refresh
 * lands mid-run. The Scope holds the Snapshot until every admitted task
 * settles and releases it on success, failure, and interruption alike.
 * Callers create their per-run caches before this call and close over them in
 * `run`; the Snapshot-bound `reads` is threaded to each task.
 *
 * @returns an Effect that fails with the Snapshot or task error. An abort
 *   interrupts the Effect; it is not a typed failure.
 */
export function runBatchWrite<T extends BatchRunTask>(opts: {
  zoteroReads: Pick<ZoteroReads["Service"], "snapshot">;
  tasks: readonly T[];
  controls: BatchRunControls;
  concurrency: number;
  run: (task: T, reads: ZoteroReadsApi) => Promise<RunOutcome>;
  onTaskFailed?: (task: T, error: unknown) => void;
  haltOn?: (error: unknown) => boolean;
}): Effect.Effect<BatchRunResult, unknown> {
  return Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* opts.zoteroReads.snapshot;
      return yield* executeBatchRun({
        tasks: opts.tasks,
        controls: opts.controls,
        concurrency: opts.concurrency,
        run: (task) =>
          Effect.tryPromise({
            try: () => opts.run(task, reads),
            catch: (error) => error,
          }),
        onTaskFailed: opts.onTaskFailed,
        haltOn: opts.haltOn,
      });
    }),
  );
}

/**
 * Run an Effect-native batch operation from a Promise caller. This is the
 * caller boundary: typed failures and defects keep their identity, while an
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
  if (Exit.isFailure(exit)) {
    if (signal?.aborted && Cause.hasInterruptsOnly(exit.cause))
      throw signal.reason;
    throw Cause.squash(exit.cause);
  }
  return exit.value;
}
