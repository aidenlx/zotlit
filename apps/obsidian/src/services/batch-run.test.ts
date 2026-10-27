import { it } from "@effect/vitest";
import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  References,
  Schema,
  Stream,
} from "effect";
import { describe, expect, vi } from "vitest";

import type { Library } from "@zotlit/db";

import { stubService } from "@/lib/__fixtures__/service-stub";
import { LogCategory } from "@/lib/effect-log";
import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import { LibraryScope } from "@/services/library-scope/service";
import { BatchUpdateRefusedError } from "@/services/note-feature/update-batch";
import { NoteImportProfileError } from "@/services/note-import/service";
import { readsAnswering } from "@/services/zotero-reads/__fixtures__";
import { DbUnavailable } from "@/services/zotero-reads/rpc";
import { ZoteroReads } from "@/services/zotero-reads/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import {
  classifyStream,
  executeBatchRun,
  makeStopRequest,
  runBatchWith,
} from "./batch-run";
import type {
  BatchClassifyControls,
  BatchRunControls,
  BatchRunTask,
  RunOutcome,
} from "./batch-run";
import { planBatchScope, resolveBatchScope } from "./batch-scope";
import { resolveLibraryScope } from "./library-scope/scope";

/** The failure a test task answers its write with. */
class WriteFailed extends Schema.TaggedError<
  WriteFailed,
  { readonly brand: unique symbol }
>()("WriteFailed", { message: Schema.String }) {}

/** Settle event recorder for a run's controls, plus `requestStop` so a test can
 * stop the run mid-run from inside a settle callback. */
function makeRunControls(onSettle?: () => void): {
  controls: BatchRunControls;
  requestStop: () => void;
  settled: Parameters<BatchRunControls["onItemSettled"]>[0][];
} {
  const { stop, request: requestStop } = makeStopRequest();
  const settled: Parameters<BatchRunControls["onItemSettled"]>[0][] = [];
  const controls: BatchRunControls = {
    onItemSettled: (event) => {
      settled.push(event);
      onSettle?.();
    },
    stop,
  };
  return { controls, requestStop, settled };
}

function task(id: number): BatchRunTask {
  return { id, label: `Item ${id}` };
}

/** A ZoteroReads service whose Snapshot acquisition is observable. */
function makeSnapshotReads(reads: ZoteroReadsApi): {
  zoteroReads: Pick<ZoteroReads["Service"], "snapshot">;
  dispose: ReturnType<typeof vi.fn>;
} {
  const dispose = vi.fn();
  return {
    zoteroReads: stubService<ZoteroReads["Service"]>("ZoteroReads", {
      snapshot: Effect.acquireRelease(Effect.succeed(reads), () =>
        Effect.sync(() => dispose()),
      ),
    }),
    dispose,
  };
}

describe("executeBatchRun", () => {
  it.effect("tallies outcomes and reports a settle event per task", () =>
    Effect.gen(function* () {
      const { controls, settled } = makeRunControls();
      const outcomes: Record<number, RunOutcome> = {
        1: "created",
        2: "updated",
        3: "skipped",
      };

      const result = yield* executeBatchRun({
        tasks: [task(1), task(2), task(3)],
        controls,
        concurrency: 4,
        run: (t) => Effect.succeed(outcomes[t.id]!),
      });

      expect(result).toEqual({
        created: 1,
        updated: 1,
        skipped: 1,
        failed: 0,
        cancelled: false,
      });
      expect(settled).toEqual(
        expect.arrayContaining([
          { id: 1, status: "done" },
          { id: 2, status: "done" },
          { id: 3, status: "skipped" },
        ]),
      );
    }),
  );

  it.effect(
    "reports a task as it settles while another admitted task still runs",
    () =>
      Effect.gen(function* () {
        const secondSettled = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const started = Promise.withResolvers<void>();
        const { controls, settled } = makeRunControls(() => {
          if (settled.at(-1)?.id === 2) secondSettled.resolve();
        });
        const pending = yield* Effect.forkChild(
          executeBatchRun({
            tasks: [task(1), task(2)],
            controls,
            concurrency: 2,
            run: (t) =>
              t.id === 1
                ? Effect.promise(() => {
                    started.resolve();
                    return release.promise;
                  }).pipe(Effect.as("created" as const))
                : Effect.succeed("updated" as const),
          }),
        );
        yield* Effect.promise(() => started.promise);
        // Task 2 settles on its own while task 1 stays admitted and unfinished.
        yield* Effect.promise(() => secondSettled.promise);
        expect(settled).toEqual([{ id: 2, status: "done" }]);
        release.resolve();
        expect(yield* Fiber.join(pending)).toMatchObject({
          created: 1,
          updated: 1,
        });
        expect(settled).toContainEqual({ id: 1, status: "done" });
      }),
  );

  it.effect("honours the concurrency limit", () =>
    Effect.gen(function* () {
      const allStarted = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let active = 0;
      let peak = 0;
      let started = 0;
      const { controls } = makeRunControls();
      const pending = yield* Effect.forkChild(
        executeBatchRun({
          tasks: [1, 2, 3, 4, 5].map(task),
          controls,
          concurrency: 3,
          run: () =>
            Effect.promise(() => {
              active += 1;
              peak = Math.max(peak, active);
              started += 1;
              if (started === 3) allStarted.resolve();
              return release.promise;
            }).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  active -= 1;
                }),
              ),
              Effect.as("created" as const),
            ),
        }),
      );

      yield* Effect.promise(() => allStarted.promise);
      expect(peak).toBe(3);
      expect(active).toBe(3);
      release.resolve();
      expect(yield* Fiber.join(pending)).toMatchObject({ created: 5 });
      expect(peak).toBe(3);
    }),
  );

  it.effect(
    "keeps admitted work running when the run's stop is requested mid-run",
    () =>
      Effect.gen(function* () {
        const { controls, requestStop, settled } = makeRunControls();
        const started = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const run = vi.fn((t: BatchRunTask) =>
          Effect.tryPromise(async () => {
            if (t.id !== 1) return "created" as const;
            started.resolve();
            await release.promise;
            return "created" as const;
          }),
        );

        const pending = yield* Effect.forkChild(
          executeBatchRun({
            tasks: [task(1), task(2), task(3)],
            controls,
            concurrency: 1,
            run,
          }),
        );

        yield* Effect.promise(() => started.promise);
        requestStop();
        expect(settled).toHaveLength(0);
        release.resolve();
        const result = yield* Fiber.join(pending);
        expect(run).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ created: 1, cancelled: true });
        expect(settled).toEqual([{ id: 1, status: "done" }]);
      }),
  );

  it.effect("counts a throwing task as failed and reports its error", () =>
    Effect.gen(function* () {
      const { controls, settled } = makeRunControls();
      const onTaskFailed = vi.fn();

      const result = yield* executeBatchRun({
        tasks: [task(1), task(2)],
        controls,
        concurrency: 4,
        run: (t) =>
          t.id === 2
            ? Effect.fail(new WriteFailed({ message: "write blew up" }))
            : Effect.succeed("created" as const),
        onTaskFailed,
      });

      expect(result).toMatchObject({
        created: 1,
        failed: 1,
        cancelled: false,
      });
      expect(settled).toContainEqual({
        id: 2,
        status: "failed",
        failure: { label: "Item 2", message: "write blew up" },
      });
      expect(onTaskFailed).toHaveBeenCalledTimes(1);
      expect(onTaskFailed.mock.calls[0]![0]).toMatchObject({ id: 2 });
    }),
  );

  it.effect.each([
    new BatchUpdateRefusedError({
      diagnostic: unknownProfileDiagnostic("Missing", {
        path: "Reading/Paper.md",
      }),
    }),
    NoteImportProfileError.unknown("Missing", { path: "Reading/Paper.md" }),
  ])("keeps note recovery on a per-item Profile failure: $name", (error) =>
    Effect.gen(function* () {
      const { controls, settled } = makeRunControls();
      yield* executeBatchRun({
        tasks: [task(1)],
        controls,
        concurrency: 1,
        run: () => Effect.fail(error),
      });
      expect(settled).toEqual([
        {
          id: 1,
          status: "failed",
          failure: {
            label: "Item 1",
            message: error.message,
            recovery: { action: "switch-profile", path: "Reading/Paper.md" },
          },
        },
      ]);
    }),
  );

  it.effect("runs no tasks when the stop is already requested", () =>
    Effect.gen(function* () {
      const { controls, requestStop, settled } = makeRunControls();
      requestStop();
      const run = vi.fn(() => Effect.succeed("created" as const));

      const result = yield* executeBatchRun({
        tasks: [task(1), task(2)],
        controls,
        concurrency: 4,
        run,
      });

      expect(run).not.toHaveBeenCalled();
      expect(settled).toHaveLength(0);
      expect(result).toEqual({
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        cancelled: true,
      });
    }),
  );

  it.effect("stops issuing new work once the stop is requested mid-run", () =>
    Effect.gen(function* () {
      const { controls, requestStop, settled } = makeRunControls(() =>
        requestStop(),
      );
      const run = vi.fn(() => Effect.succeed("created" as const));

      const result = yield* executeBatchRun({
        tasks: [task(1), task(2), task(3)],
        controls,
        concurrency: 1,
        run,
      });

      // Task 1 runs and settles; its settle requests the stop, so tasks 2 and 3 never run.
      expect(run).toHaveBeenCalledTimes(1);
      expect(settled).toHaveLength(1);
      expect(result).toMatchObject({ created: 1, failed: 0, cancelled: true });
    }),
  );

  it.effect(
    "halts the run with the first matching error after in-flight work settles",
    () =>
      Effect.gen(function* () {
        const { controls, settled } = makeRunControls();
        const release = Promise.withResolvers<void>();
        const bothStarted = Promise.withResolvers<void>();
        class ConfigError extends Error {}
        const firstError = new ConfigError("bad config");
        let starts = 0;
        const run = vi.fn((t: BatchRunTask) =>
          Effect.gen(function* () {
            starts += 1;
            if (starts === 2) bothStarted.resolve();
            if (t.id === 2) return yield* Effect.fail(firstError);
            if (t.id === 1) yield* Effect.promise(() => release.promise);
            return "created" as const;
          }),
        );

        const pending = yield* Effect.forkChild(
          executeBatchRun({
            tasks: [task(1), task(2), task(3)],
            controls,
            concurrency: 2,
            run,
            haltOn: (error) => error instanceof ConfigError,
          }),
        );
        yield* Effect.promise(() => bothStarted.promise);
        yield* Effect.yieldNow;
        release.resolve();
        const exit = yield* Effect.exit(Fiber.join(pending));

        expect(Exit.isFailure(exit)).toBe(true);
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(
          firstError,
        );
        expect(run).toHaveBeenCalledTimes(2);
        expect(settled).toEqual([{ id: 1, status: "done" }]);
      }),
  );

  it.effect("still reports a per-item failure for a non-matching error", () =>
    Effect.gen(function* () {
      const { controls, settled } = makeRunControls();
      class ConfigError extends Error {}

      const result = yield* executeBatchRun({
        tasks: [task(1)],
        controls,
        concurrency: 1,
        run: () => Effect.fail(new WriteFailed({ message: "write blew up" })),
        haltOn: (error) => error instanceof ConfigError,
      });

      expect(result).toMatchObject({ failed: 1 });
      expect(settled).toContainEqual({
        id: 1,
        status: "failed",
        failure: { label: "Item 1", message: "write blew up" },
      });
    }),
  );
});

describe("a task that awaits a rejected Promise", () => {
  it.effect("reports the rejection's own error on its failure row", () =>
    Effect.gen(function* () {
      const { controls, settled } = makeRunControls();
      const failure = NoteImportProfileError.unknown("Missing", {
        path: "Reading/Paper.md",
      });
      const onTaskFailed = vi.fn();

      const result = yield* executeBatchRun({
        tasks: [task(1)],
        controls,
        concurrency: 1,
        run: () => Effect.promise(() => Promise.reject(failure)),
        onTaskFailed,
      });

      expect(result).toMatchObject({ failed: 1 });
      expect(settled).toEqual([
        {
          id: 1,
          status: "failed",
          failure: {
            label: "Item 1",
            message: failure.message,
            recovery: { action: "switch-profile", path: "Reading/Paper.md" },
          },
        },
      ]);
      expect(onTaskFailed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        failure,
      );
    }),
  );

  it.effect("never halts the run on a defect", () =>
    Effect.gen(function* () {
      const { controls, settled } = makeRunControls();
      const failure = new Error("bad config");

      const result = yield* executeBatchRun({
        tasks: [task(1)],
        controls,
        concurrency: 1,
        run: () => Effect.promise(() => Promise.reject(failure)),
        haltOn: () => true,
      });

      expect(result).toMatchObject({ failed: 1 });
      expect(settled).toEqual([
        {
          id: 1,
          status: "failed",
          failure: { label: "Item 1", message: "bad config" },
        },
      ]);
    }),
  );

  it.effect("reports an abort-named failure as a failed item", () =>
    Effect.gen(function* () {
      const { controls, settled } = makeRunControls();
      const onTaskFailed = vi.fn();

      const result = yield* executeBatchRun({
        tasks: [task(1)],
        controls,
        concurrency: 1,
        run: () => Effect.die(new DOMException("released", "AbortError")),
        onTaskFailed,
      });

      expect(result).toMatchObject({ failed: 1, cancelled: false });
      expect(settled).toEqual([
        {
          id: 1,
          status: "failed",
          failure: { label: "Item 1", message: "released" },
        },
      ]);
      expect(onTaskFailed).toHaveBeenCalledTimes(1);
    }),
  );
});

describe("a halted run", () => {
  it.effect("fails with the halting failure itself", () =>
    Effect.gen(function* () {
      const { controls } = makeRunControls();
      const failure = new WriteFailed({ message: "bad config" });
      const onTaskFailed = vi.fn();

      const error = yield* Effect.flip(
        executeBatchRun({
          tasks: [task(1)],
          controls,
          concurrency: 4,
          run: () => Effect.fail(failure),
          onTaskFailed,
          haltOn: (error) => error === failure,
        }),
      );

      expect(error).toBe(failure);
      expect(onTaskFailed).not.toHaveBeenCalled();
    }),
  );
});

/** The Promise edge a batch modal's runner uses, over the default runtime. */
const runBatch = runBatchWith((effect, options) =>
  Effect.runPromiseExit(effect, options),
);

describe("runBatchWith", () => {
  it("keeps a typed failure that lands after the signal aborts", async () => {
    const abort = new AbortController();
    const error = new DbUnavailable({ message: "database degraded" });
    const effect = Effect.uninterruptible(
      Effect.gen(function* () {
        abort.abort();
        return yield* error;
      }),
    );

    await expect(runBatch(effect, abort.signal)).rejects.toBe(error);
  });
});

describe("classifyStream", () => {
  /** The controls a batch modal hands its classify step, and its cancel. */
  function classifyControls(): {
    controls: BatchClassifyControls;
    abort: AbortController;
    progress: number[];
  } {
    const abort = new AbortController();
    const progress: number[] = [];
    return {
      controls: {
        onProgress: (n) => progress.push(n),
        signal: abort.signal,
      },
      abort,
      progress,
    };
  }

  /**
   * Runs `build`'s classification in its own fiber and returns how it ended.
   * `interrupt` stops that fiber; `early` interrupts it before it starts.
   */
  function exitOf<A, E>(
    build: (interrupt: () => void) => Effect.Effect<A, E>,
    { early = false }: { early?: boolean } = {},
  ): Effect.Effect<Exit.Exit<A, E>> {
    return Effect.gen(function* () {
      let run: Fiber.Fiber<A, E> | undefined;
      const interrupt = () => run?.interruptUnsafe();
      run = yield* Effect.forkChild(build(interrupt), {
        startImmediately: false,
      });
      if (early) interrupt();
      return yield* Fiber.await(run);
    });
  }

  it.effect(
    "bounds each request while preserving order, duplicates, and cumulative progress",
    () =>
      Effect.gen(function* () {
        const { controls, progress } = classifyControls();
        const itemIDs = Array.from(
          { length: 100_001 },
          (_, index) => index % 997,
        );
        const requested: number[][] = [];
        const seen: number[] = [];
        yield* classifyStream(
          {
            itemIDs,
            read: (ids) => {
              requested.push([...ids]);
              return Stream.succeed(ids);
            },
          },
          controls,
          (slice) => seen.push(...slice),
        );
        expect(requested.every((ids) => ids.length <= 500)).toBe(true);
        expect(requested.flat()).toEqual(itemIDs);
        expect(seen).toEqual(itemIDs);
        expect(progress).toEqual(
          requested.map((_, index) =>
            Math.min((index + 1) * 500, itemIDs.length),
          ),
        );
      }),
  );

  it.effect("starts no further request after interruption", () =>
    Effect.gen(function* () {
      const { controls } = classifyControls();
      const read = vi.fn((ids: readonly number[]) => Stream.succeed(ids));
      const exit = yield* exitOf((interrupt) =>
        classifyStream(
          { itemIDs: Array.from({ length: 1001 }, (_, i) => i), read },
          controls,
          interrupt,
        ),
      );
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
        true,
      );
      expect(read).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("propagates a read failure without requesting the next slice", () =>
    Effect.gen(function* () {
      const { controls, progress } = classifyControls();
      const read = vi.fn(() => Stream.fail(new Error("read failed")));
      const exit = yield* Effect.exit(
        classifyStream(
          { itemIDs: Array.from({ length: 1001 }, (_, i) => i), read },
          controls,
          () => {},
        ),
      );
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
        message: "read failed",
      });
      expect(read).toHaveBeenCalledTimes(1);
      expect(progress).toEqual([]);
    }),
  );

  it.effect("completes an empty selection without reading", () =>
    Effect.gen(function* () {
      const { controls, progress } = classifyControls();
      const read = vi.fn(() => Stream.succeed([]));
      yield* classifyStream({ itemIDs: [], read }, controls, () => {});
      expect(read).not.toHaveBeenCalled();
      expect(progress).toEqual([]);
    }),
  );

  it.effect("reads nothing when interrupted before it starts", () =>
    Effect.gen(function* () {
      const { controls } = classifyControls();
      const read = vi.fn(() => Stream.succeed([1, 2, 3]));
      const processSlice = vi.fn();

      const exit = yield* exitOf(
        () =>
          classifyStream({ itemIDs: [1, 2, 3], read }, controls, processSlice),
        { early: true },
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
        true,
      );
      expect(read).not.toHaveBeenCalled();
      expect(processSlice).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    "runBatchWith rejects a pre-aborted classification before any read",
    () =>
      Effect.gen(function* () {
        const { controls, abort } = classifyControls();
        abort.abort();
        const read = vi.fn(() => Stream.succeed([1, 2, 3]));
        const processSlice = vi.fn();

        yield* Effect.promise(async () => {
          await expect(
            runBatch(
              classifyStream(
                { itemIDs: [1, 2, 3], read },
                controls,
                processSlice,
              ),
              controls.signal,
            ),
          ).rejects.toMatchObject({ name: "AbortError" });
        });
        expect(read).not.toHaveBeenCalled();
        expect(processSlice).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    "interrupts a stream whose slices arrive synchronously at the next slice",
    () =>
      Effect.gen(function* () {
        const { controls } = classifyControls();
        let interrupted = false;
        const slices = Stream.fromIterable([[1], [2], [3]], {
          chunkSize: 1,
        }).pipe(
          Stream.onExit((exit) =>
            Effect.sync(() => {
              interrupted = Exit.hasInterrupts(exit);
            }),
          ),
        );
        const seen: number[] = [];

        const exit = yield* exitOf((interrupt) =>
          classifyStream(
            { itemIDs: [1, 2, 3], read: () => slices },
            controls,
            (slice) => {
              seen.push(...slice);
              interrupt();
            },
          ),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        expect(interrupted).toBe(true);
        expect(seen).toEqual([1]);
      }),
  );

  it.effect("interrupts the read when the signal aborts mid-classify", () =>
    Effect.gen(function* () {
      const { controls, abort } = classifyControls();
      const held = Promise.withResolvers<void>();
      let interrupted = false;
      const slices = Stream.concat(
        Stream.make([1, 2]),
        Stream.fromEffect(
          Effect.as(
            Effect.promise(() => held.promise),
            [3],
          ),
        ),
      ).pipe(
        Stream.onExit((exit) =>
          Effect.sync(() => {
            interrupted = Exit.hasInterrupts(exit);
          }),
        ),
      );
      const seen: number[] = [];

      yield* Effect.promise(async () => {
        await expect(
          runBatch(
            classifyStream(
              { itemIDs: [1, 2, 3], read: () => slices },
              controls,
              (slice) => {
                seen.push(...slice);
                abort.abort();
              },
            ),
            controls.signal,
          ),
        ).rejects.toMatchObject({ name: "AbortError" });
      });
      expect(interrupted).toBe(true);
      expect(seen).toEqual([1, 2]);
      held.resolve();
    }),
  );
});

describe("planBatchScope", () => {
  const PERSONAL_LIBRARY: Library = {
    libraryID: 1,
    version: 0,
    clientVersion: null,
    type: "user",
    groupID: null,
    name: null,
  };
  const GROUP_LIBRARY: Library = {
    libraryID: 12,
    version: 0,
    clientVersion: null,
    type: "group",
    groupID: 7,
    name: "Reading group",
  };
  const EARLIER_GROUP_LIBRARY: Library = {
    libraryID: 4,
    version: 0,
    clientVersion: null,
    type: "group",
    groupID: 3,
    name: "Earlier group",
  };

  function planningReads() {
    const libraries = vi.fn(() =>
      Effect.succeed([GROUP_LIBRARY, EARLIER_GROUP_LIBRARY, PERSONAL_LIBRARY]),
    );
    const scopeItemIDs = vi.fn(({ libraryID }: { libraryID: number }) => {
      const itemIDs =
        libraryID === PERSONAL_LIBRARY.libraryID
          ? [1, 2]
          : libraryID === EARLIER_GROUP_LIBRARY.libraryID
            ? [4]
            : [3];
      return Effect.succeed(itemIDs);
    });
    const reads = {
      Libraries: libraries,
      ScopeItemIDs: scopeItemIDs,
    } as unknown as ZoteroReadsApi;
    return { ...makeSnapshotReads(reads), libraries, scopeItemIDs };
  }

  /** The tags planBatchScope reads: the Snapshot and Library Scope. */
  function planningServices(
    zoteroReads: Pick<ZoteroReads["Service"], "snapshot">,
    resolveLibraries: LibraryScope["Service"]["resolveLibraries"],
  ) {
    return Layer.mergeAll(
      Layer.mock(ZoteroReads, {
        // The plan reads only through its Snapshot.
        reads: readsAnswering({}),
        snapshot: zoteroReads.snapshot,
      }),
      Layer.mock(LibraryScope, { resolveLibraries }),
    );
  }

  it.effect("does not resolve Library Scope for an exact target", () =>
    Effect.gen(function* () {
      const { zoteroReads, dispose, scopeItemIDs } = planningReads();
      const resolveLibraries = vi.fn(() =>
        Effect.die(new Error("Library Scope read")),
      );

      const plan = yield* planBatchScope("literature-items", {
        groupID: 7,
      }).pipe(Effect.provide(planningServices(zoteroReads, resolveLibraries)));

      expect(plan).toEqual({
        outcome: "resolved",
        itemIDs: [3],
        unavailableLibraries: 0,
      });
      expect(resolveLibraries).not.toHaveBeenCalled();
      expect(scopeItemIDs).toHaveBeenCalledWith({
        kind: "literature-items",
        libraryID: GROUP_LIBRARY.libraryID,
      });
      expect(dispose).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect(
    "concatenates Libraries in canonical order for an unqualified run",
    () =>
      Effect.gen(function* () {
        const { zoteroReads, dispose, scopeItemIDs } = planningReads();

        const plan = yield* planBatchScope("notes", {}).pipe(
          Effect.provide(
            planningServices(zoteroReads, (libraries) =>
              Effect.sync(() =>
                resolveLibraryScope(libraries, { mode: "all" }),
              ),
            ),
          ),
        );

        expect(plan).toEqual({
          outcome: "resolved",
          itemIDs: [1, 2, 4, 3],
          unavailableLibraries: 0,
        });
        expect(
          scopeItemIDs.mock.calls.map(([request]) => request.libraryID),
        ).toEqual([
          PERSONAL_LIBRARY.libraryID,
          EARLIER_GROUP_LIBRARY.libraryID,
          GROUP_LIBRARY.libraryID,
        ]);
        expect(dispose).toHaveBeenCalledTimes(1);
      }),
  );

  it.effect("logs scope misses with fields and the batch-scope category", () =>
    Effect.gen(function* () {
      const logs: {
        level: string;
        category: readonly string[];
        annotations: Record<string, unknown>;
      }[] = [];
      const capture = Logger.make(({ logLevel, fiber }) => {
        logs.push({
          level: logLevel,
          category: fiber.getRef(LogCategory),
          annotations: fiber.getRef(References.CurrentLogAnnotations),
        });
      });
      const logger = Logger.layer([capture]);
      const missingTargetReads = {
        ScopeItemIDs: vi.fn(),
      } as unknown as ZoteroReadsApi;

      yield* resolveBatchScope(missingTargetReads, "notes", {
        target: { groupID: 99 },
        libraries: [PERSONAL_LIBRARY, GROUP_LIBRARY],
      }).pipe(Effect.provide(logger));

      const collectionReads = {
        ScopeItemIDs: vi.fn(() => Effect.succeed(null)),
      } as unknown as ZoteroReadsApi;
      yield* resolveBatchScope(collectionReads, "notes", {
        target: { groupID: 7, collectionKey: "MISSING" },
        libraries: [PERSONAL_LIBRARY, GROUP_LIBRARY],
      }).pipe(Effect.provide(logger));

      const { zoteroReads } = planningReads();
      yield* planBatchScope("notes", {}).pipe(
        Effect.provide(
          Layer.merge(
            planningServices(zoteroReads, () =>
              Effect.succeed({
                mode: "selected",
                invalid: false,
                available: [],
                unavailable: [{ type: "group", groupID: 99 }],
              }),
            ),
            logger,
          ),
        ),
      );

      expect(logs).toHaveLength(3);
      expect(logs[0]).toMatchObject({
        level: "Debug",
        category: ["batch-scope"],
        annotations: { kind: "notes", groupID: 99 },
      });
      expect(logs[1]).toMatchObject({
        level: "Debug",
        category: ["batch-scope"],
        annotations: {
          kind: "notes",
          libraryID: GROUP_LIBRARY.libraryID,
          collectionKey: "MISSING",
        },
      });
      expect(logs[2]).toMatchObject({
        level: "Debug",
        category: ["batch-scope"],
        annotations: { kind: "notes" },
      });
    }),
  );
});
