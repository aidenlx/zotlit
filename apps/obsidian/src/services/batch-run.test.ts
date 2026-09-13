import { describe, expect, it, vi } from "vitest";

import type { NodeDatabaseClient } from "@zotlit/db/client/node";

import { unknownProfileDiagnostic } from "@/lib/profile-stamp";
import { BatchUpdateRefusedError } from "@/services/note-feature/update-batch";
import { NoteImportProfileError } from "@/services/note-import/service";

import { classifyChunked, executeBatchRun, runBatchWrite } from "./batch-run";
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

const sentinelClient = { $sentinel: true } as unknown as NodeDatabaseClient;

/** Lease stub whose dispose is observable, matching DatabaseReadLease's shape. */
function makeLeasingDb(client: NodeDatabaseClient = sentinelClient): {
  db: {
    acquireRead: () => Promise<Disposable & { client: NodeDatabaseClient }>;
  };
  acquireRead: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  const dispose = vi.fn();
  const acquireRead = vi.fn(async () => ({
    client,
    [Symbol.dispose]: dispose,
  }));
  return { db: { acquireRead }, acquireRead, dispose };
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
  it("pins one lease for the whole run and threads its client to each task", async () => {
    const { db, acquireRead, dispose } = makeLeasingDb();
    const { controls } = makeRunControls();
    const seenClients: NodeDatabaseClient[] = [];

    const result = await runBatchWrite({
      db,
      tasks: [task(1), task(2), task(3)],
      controls,
      concurrency: 4,
      run: async (_t, client) => {
        seenClients.push(client);
        return "updated";
      },
    });

    expect(acquireRead).toHaveBeenCalledTimes(1);
    expect(seenClients).toEqual([
      sentinelClient,
      sentinelClient,
      sentinelClient,
    ]);
    expect(result).toMatchObject({ updated: 3 });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("memoizes a shared fetch once per run across items sharing a key", async () => {
    const { db } = makeLeasingDb();
    const { controls } = makeRunControls();
    const fetchSpy = vi.fn((_client: NodeDatabaseClient, key: string) => key);
    // A per-run cache the caller closes over, mirroring the real tagMemo /
    // collectionCache threading.
    const memo = new Map<string, string>();
    const cachedFetch = (client: NodeDatabaseClient, key: string): string => {
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      const value = fetchSpy(client, key);
      memo.set(key, value);
      return value;
    };

    await runBatchWrite({
      db,
      // Three tasks, two of which resolve to the same shared "author:1" key.
      tasks: [task(1), task(2), task(3)],
      controls,
      concurrency: 1,
      run: async (t, client) => {
        cachedFetch(client, t.id === 3 ? "author:2" : "author:1");
        return "updated";
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("holds the lease until every task settles", async () => {
    const { db, dispose } = makeLeasingDb();
    const { controls } = makeRunControls();
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = runBatchWrite({
      db,
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
    const { db, dispose } = makeLeasingDb();
    const { controls } = makeRunControls();

    await runBatchWrite({
      db,
      tasks: [task(1)],
      controls,
      concurrency: 4,
      run: async () => "created",
    });

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("releases the lease when the signal aborts before any task runs", async () => {
    const { db, dispose } = makeLeasingDb();
    const { controls, abort } = makeRunControls();
    abort.abort();
    const run = vi.fn(async () => "created" as const);

    const result = await runBatchWrite({
      db,
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
    const { db, dispose } = makeLeasingDb();
    const { controls } = makeRunControls();

    await expect(
      runBatchWrite({
        db,
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
    const { db, dispose } = makeLeasingDb();
    const { controls } = makeRunControls();
    class ConfigError extends Error {}

    await expect(
      runBatchWrite({
        db,
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
        db: { acquireRead } as never,
        tasks: [task(1)],
        controls,
        concurrency: 4,
        run: async () => "created",
      }),
    ).rejects.toThrow("degraded");
  });
});

describe("classifyChunked", () => {
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

  it("processes every id in fixed-size chunks and reports cumulative progress", async () => {
    const { controls, progress } = classifyControls();
    const ids = Array.from({ length: 120 }, (_, i) => i);
    const seen: number[] = [];

    await classifyChunked(ids, controls, (slice) => {
      seen.push(...slice);
    });

    expect(seen).toEqual(ids);
    // 120 ids at a 50-chunk stride: 50, 100, 120.
    expect(progress).toEqual([50, 100, 120]);
  });

  it("throws and stops processing once aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    const { controls } = classifyControls(abort.signal);
    const processSlice = vi.fn();

    await expect(
      classifyChunked([1, 2, 3], controls, processSlice),
    ).rejects.toThrow();
    expect(processSlice).not.toHaveBeenCalled();
  });
});
