import { Effect, Exit, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import { BatchUpdateRefusedError } from "@/services/note-feature/update-batch";
import { NoteImportProfileError } from "@/services/note-import/service";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import { classifyStream, executeBatchRun, runBatchWrite } from "./batch-run";
import type {
  BatchClassifyControls,
  BatchRunControls,
  BatchRunTask,
  RunOutcome,
} from "./batch-run";

/** Settle event recorder for a run's controls, plus the abort controller so a
 * test can cancel mid-run from inside a settle callback. */
function makeRunControls(onSettle?: () => void): {
  controls: BatchRunControls;
  abort: AbortController;
  settled: Parameters<BatchRunControls["onItemSettled"]>[0][];
} {
  const abort = new AbortController();
  const settled: Parameters<BatchRunControls["onItemSettled"]>[0][] = [];
  const controls: BatchRunControls = {
    onItemSettled: (event) => {
      settled.push(event);
      onSettle?.();
    },
    signal: abort.signal,
  };
  return { controls, abort, settled };
}

function task(id: number): BatchRunTask {
  return { id, label: `Item ${id}` };
}

const sentinelReads = { $sentinel: true } as unknown as ZoteroReadsApi;

/** Lease stub whose dispose is observable, matching ZoteroReadLease's shape. */
function makeLeasingReads(reads: ZoteroReadsApi = sentinelReads): {
  zoteroReads: {
    acquireRead: () => Promise<AsyncDisposable & { reads: ZoteroReadsApi }>;
  };
  acquireRead: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  const dispose = vi.fn(async () => {});
  const acquireRead = vi.fn(async () => ({
    reads,
    [Symbol.asyncDispose]: dispose,
  }));
  return { zoteroReads: { acquireRead }, acquireRead, dispose };
}

describe("executeBatchRun", () => {
  it("tallies outcomes and reports a settle event per task", async () => {
    const { controls, settled } = makeRunControls();
    const outcomes: Record<number, RunOutcome> = {
      1: "created",
      2: "updated",
      3: "skipped",
    };

    const result = await executeBatchRun({
      tasks: [task(1), task(2), task(3)],
      controls,
      concurrency: 4,
      run: async (t) => outcomes[t.id]!,
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
  });

  it("reports a task as it settles while another admitted task still runs", async () => {
    const secondSettled = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const abort = new AbortController();
    const settled: Parameters<BatchRunControls["onItemSettled"]>[0][] = [];
    const controls: BatchRunControls = {
      signal: abort.signal,
      onItemSettled: (event) => {
        settled.push(event);
        if (event.id === 2) secondSettled.resolve();
      },
    };
    const pending = executeBatchRun({
      tasks: [task(1), task(2)],
      controls,
      concurrency: 2,
      run: async (t) => {
        if (t.id === 1) {
          started.resolve();
          await release.promise;
          return "created";
        }
        return "updated";
      },
    });
    await started.promise;
    // Task 2 settles on its own while task 1 stays admitted and unfinished.
    await secondSettled.promise;
    expect(settled).toEqual([{ id: 2, status: "done" }]);
    release.resolve();
    expect(await pending).toMatchObject({ created: 1, updated: 1 });
    expect(settled).toContainEqual({ id: 1, status: "done" });
  });

  it("keeps admitted work running when the run's signal aborts mid-run", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const { controls, abort, settled } = makeRunControls();
    const pending = executeBatchRun({
      tasks: [task(1), task(2)],
      controls,
      concurrency: 1,
      run: async (t) => {
        if (t.id !== 1) return "created";
        started.resolve();
        await release.promise;
        return "created";
      },
    });
    await started.promise;
    // The shell's signal is the only one this run observes, and an observer
    // giving up mid-run cancels through it. Cancellation stops queued demand
    // and nothing else: the admitted write is neither cancelled nor reported
    // settled by it.
    abort.abort();
    expect(settled).toHaveLength(0);
    release.resolve();
    expect(await pending).toMatchObject({ created: 1, cancelled: true });
    expect(settled).toEqual([{ id: 1, status: "done" }]);
  });

  it("counts a throwing task as failed and reports its error", async () => {
    const { controls, settled } = makeRunControls();
    const onTaskFailed = vi.fn();

    const result = await executeBatchRun({
      tasks: [task(1), task(2)],
      controls,
      concurrency: 4,
      run: async (t) => {
        if (t.id === 2) throw new Error("write blew up");
        return "created";
      },
      onTaskFailed,
    });

    expect(result).toMatchObject({ created: 1, failed: 1, cancelled: false });
    expect(settled).toContainEqual({
      id: 2,
      status: "failed",
      failure: { label: "Item 2", message: "write blew up" },
    });
    expect(onTaskFailed).toHaveBeenCalledTimes(1);
    expect(onTaskFailed.mock.calls[0]![0]).toMatchObject({ id: 2 });
  });

  it.each([
    new BatchUpdateRefusedError(
      unknownProfileDiagnostic("Missing", { path: "Reading/Paper.md" }),
    ),
    new NoteImportProfileError("Missing", { path: "Reading/Paper.md" }),
  ])(
    "keeps note recovery on a per-item Profile failure: $name",
    async (error) => {
      const { controls, settled } = makeRunControls();
      await executeBatchRun({
        tasks: [task(1)],
        controls,
        concurrency: 1,
        run: async () => {
          throw error;
        },
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
    },
  );

  it("runs no tasks when the signal is already aborted", async () => {
    const { controls, abort, settled } = makeRunControls();
    abort.abort();
    const run = vi.fn(async () => "created" as const);

    const result = await executeBatchRun({
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
  });

  it("stops issuing new work once aborted mid-run", async () => {
    const abort = new AbortController();
    const settled: unknown[] = [];
    const controls: BatchRunControls = {
      onItemSettled: (event) => {
        settled.push(event);
        abort.abort();
      },
      signal: abort.signal,
    };
    const run = vi.fn(async () => "created" as const);

    const result = await executeBatchRun({
      tasks: [task(1), task(2), task(3)],
      controls,
      concurrency: 1,
      run,
    });

    // Task 1 runs and settles; its settle aborts, so tasks 2 and 3 never run.
    expect(run).toHaveBeenCalledTimes(1);
    expect(settled).toHaveLength(1);
    expect(result).toMatchObject({ created: 1, failed: 0, cancelled: true });
  });

  it("halts the run and rethrows the first matching error without a failure row", async () => {
    const { controls, settled } = makeRunControls();
    class ConfigError extends Error {}
    const run = vi.fn(async (t: BatchRunTask) => {
      if (t.id === 1) throw new ConfigError("bad config");
      return "created" as const;
    });

    await expect(
      executeBatchRun({
        tasks: [task(1), task(2), task(3)],
        controls,
        concurrency: 1,
        run,
        haltOn: (error) => error instanceof ConfigError,
      }),
    ).rejects.toThrow("bad config");

    expect(run).toHaveBeenCalledTimes(1);
    expect(settled).toHaveLength(0);
  });

  it("still reports a per-item failure for a non-matching error", async () => {
    const { controls, settled } = makeRunControls();
    class ConfigError extends Error {}

    const result = await executeBatchRun({
      tasks: [task(1)],
      controls,
      concurrency: 1,
      run: async () => {
        throw new Error("write blew up");
      },
      haltOn: (error) => error instanceof ConfigError,
    });

    expect(result).toMatchObject({ failed: 1 });
    expect(settled).toContainEqual({
      id: 1,
      status: "failed",
      failure: { label: "Item 1", message: "write blew up" },
    });
  });
});

describe("runBatchWrite", () => {
  it("pins one Snapshot for the whole run and threads its reads to each task", async () => {
    const { zoteroReads, acquireRead, dispose } = makeLeasingReads();
    const { controls } = makeRunControls();
    const seenReads: ZoteroReadsApi[] = [];

    const result = await runBatchWrite({
      zoteroReads,
      tasks: [task(1), task(2), task(3)],
      controls,
      concurrency: 4,
      run: async (_t, reads) => {
        seenReads.push(reads);
        return "updated";
      },
    });

    expect(acquireRead).toHaveBeenCalledTimes(1);
    expect(seenReads).toEqual([sentinelReads, sentinelReads, sentinelReads]);
    expect(result).toMatchObject({ updated: 3 });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("memoizes a shared fetch once per run across items sharing a key", async () => {
    const { zoteroReads } = makeLeasingReads();
    const { controls } = makeRunControls();
    const fetchSpy = vi.fn((_reads: ZoteroReadsApi, key: string) => key);
    // A per-run cache the caller closes over, mirroring the real tagMemo /
    // collectionCache threading.
    const memo = new Map<string, string>();
    const cachedFetch = (reads: ZoteroReadsApi, key: string): string => {
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      const value = fetchSpy(reads, key);
      memo.set(key, value);
      return value;
    };

    await runBatchWrite({
      zoteroReads,
      // Three tasks, two of which resolve to the same shared "author:1" key.
      tasks: [task(1), task(2), task(3)],
      controls,
      concurrency: 1,
      run: async (t, reads) => {
        cachedFetch(reads, t.id === 3 ? "author:2" : "author:1");
        return "updated";
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("holds the lease until every task settles", async () => {
    const { zoteroReads, dispose } = makeLeasingReads();
    const { controls } = makeRunControls();
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = runBatchWrite({
      zoteroReads,
      tasks: [task(1)],
      controls,
      concurrency: 4,
      run: async () => {
        await inFlight;
        return "created";
      },
    });

    // The task is still awaiting; the lease must not have been released yet.
    await Promise.resolve();
    expect(dispose).not.toHaveBeenCalled();

    release();
    await pending;
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the lease after a successful run", async () => {
    const { zoteroReads, dispose } = makeLeasingReads();
    const { controls } = makeRunControls();

    await runBatchWrite({
      zoteroReads,
      tasks: [task(1)],
      controls,
      concurrency: 4,
      run: async () => "created",
    });

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the lease when the signal aborts before any task runs", async () => {
    const { zoteroReads, dispose } = makeLeasingReads();
    const { controls, abort } = makeRunControls();
    abort.abort();
    const run = vi.fn(async () => "created" as const);

    const result = await runBatchWrite({
      zoteroReads,
      tasks: [task(1), task(2)],
      controls,
      concurrency: 4,
      run,
    });

    expect(run).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the lease when the run throws after acquiring it", async () => {
    const { zoteroReads, dispose } = makeLeasingReads();
    const { controls } = makeRunControls();

    await expect(
      runBatchWrite({
        zoteroReads,
        tasks: [task(1)],
        controls,
        // Invalid concurrency makes executeBatchRun throw synchronously after
        // the lease is acquired, exercising the `using` disposal-on-throw path.
        concurrency: 0,
        run: async () => "created",
      }),
    ).rejects.toThrow();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the lease when the run halts", async () => {
    const { zoteroReads, dispose } = makeLeasingReads();
    const { controls } = makeRunControls();
    class ConfigError extends Error {}

    await expect(
      runBatchWrite({
        zoteroReads,
        tasks: [task(1)],
        controls,
        concurrency: 4,
        run: async () => {
          throw new ConfigError("bad config");
        },
        haltOn: (error) => error instanceof ConfigError,
      }),
    ).rejects.toThrow("bad config");
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("propagates a degraded acquire without leaving a lease to release", async () => {
    const acquireRead = vi.fn(async () => {
      throw new Error("degraded");
    });
    const { controls } = makeRunControls();

    await expect(
      runBatchWrite({
        zoteroReads: { acquireRead } as never,
        tasks: [task(1)],
        controls,
        concurrency: 4,
        run: async () => "created",
      }),
    ).rejects.toThrow("degraded");
  });
});

describe("classifyStream", () => {
  function classifyControls(signal?: AbortSignal): {
    controls: BatchClassifyControls;
    progress: number[];
  } {
    const progress: number[] = [];
    return {
      controls: {
        onProgress: (n) => progress.push(n),
        signal: signal ?? new AbortController().signal,
      },
      progress,
    };
  }

  it("bounds each request while preserving order, duplicates, and cumulative progress", async () => {
    const { controls, progress } = classifyControls();
    const itemIDs = Array.from({ length: 100_001 }, (_, index) => index % 997);
    const requested: number[][] = [];
    const seen: number[] = [];
    await classifyStream(
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
      requested.map((_, index) => Math.min((index + 1) * 500, itemIDs.length)),
    );
  });

  it("starts no further request after cancellation", async () => {
    const abort = new AbortController();
    const { controls } = classifyControls(abort.signal);
    const read = vi.fn((ids: readonly number[]) => Stream.succeed(ids));
    await expect(
      classifyStream(
        { itemIDs: Array.from({ length: 1001 }, (_, i) => i), read },
        controls,
        () => abort.abort(),
      ),
    ).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("propagates a read failure without requesting the next slice", async () => {
    const { controls, progress } = classifyControls();
    const read = vi.fn(() => Stream.fail(new Error("read failed")));
    await expect(
      classifyStream(
        { itemIDs: Array.from({ length: 1001 }, (_, i) => i), read },
        controls,
        () => {},
      ),
    ).rejects.toThrow("read failed");
    expect(read).toHaveBeenCalledTimes(1);
    expect(progress).toEqual([]);
  });

  it("completes an empty selection without reading", async () => {
    const { controls, progress } = classifyControls();
    const read = vi.fn(() => Stream.succeed([]));
    await classifyStream({ itemIDs: [], read }, controls, () => {});
    expect(read).not.toHaveBeenCalled();
    expect(progress).toEqual([]);
  });

  it("processes every slice in order and reports cumulative progress", async () => {
    const { controls, progress } = classifyControls();
    const seen: number[] = [];

    await classifyStream(
      {
        itemIDs: [1, 2, 3, 4, 5],
        read: () =>
          Stream.fromIterable([[1, 2], [3, 4], [5]], { chunkSize: 1 }),
      },
      controls,
      (slice) => {
        seen.push(...slice);
      },
    );

    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(progress).toEqual([2, 4, 5]);
  });

  it("throws and stops processing once aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    const { controls } = classifyControls(abort.signal);
    const processSlice = vi.fn();

    await expect(
      classifyStream(
        { itemIDs: [1, 2, 3], read: () => Stream.make([1, 2, 3]) },
        controls,
        processSlice,
      ),
    ).rejects.toThrow();
    expect(processSlice).not.toHaveBeenCalled();
  });

  it("interrupts a stream whose slices arrive synchronously at the next slice", async () => {
    const abort = new AbortController();
    const { controls } = classifyControls(abort.signal);
    let interrupted = false;
    const slices = Stream.fromIterable([[1], [2], [3]], { chunkSize: 1 }).pipe(
      Stream.onExit((exit) =>
        Effect.sync(() => {
          interrupted = Exit.hasInterrupts(exit);
        }),
      ),
    );
    const seen: number[] = [];

    const pending = classifyStream(
      { itemIDs: [1, 2, 3], read: () => slices },
      controls,
      (slice) => {
        seen.push(...slice);
        abort.abort();
      },
    );

    await expect(pending).rejects.toThrow();
    expect(interrupted).toBe(true);
    expect(seen).toEqual([1]);
  });

  it("interrupts the stream when the signal aborts mid-classify", async () => {
    const abort = new AbortController();
    const { controls } = classifyControls(abort.signal);
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

    const pending = classifyStream(
      { itemIDs: [1, 2, 3], read: () => slices },
      controls,
      (slice) => {
        seen.push(...slice);
        abort.abort();
      },
    );

    await expect(pending).rejects.toThrow();
    expect(interrupted).toBe(true);
    expect(seen).toEqual([1, 2]);
    held.resolve();
  });
});
