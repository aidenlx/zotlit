import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";

import { SLICE_BUDGET_MS } from "@zotlit/item-query";

import { MY_LIBRARY_SCOPE } from "@/services/library-scope/scope";

import type { QueryJob, WorkerReply, WorkerRequest } from "./worker-protocol";
import { QueryWorkers } from "./workers";
import type { QueryWorker } from "./workers";

/** Controls resource-closure and exit receipts independently. */
class WorkerReceipts extends EventEmitter implements QueryWorker {
  readonly started = Promise.withResolvers<QueryJob>();
  readonly stopped = Promise.withResolvers<void>();
  stopping = false;
  queries = 0;

  constructor(ready = true) {
    super();
    if (ready) queueMicrotask(() => this.reply({ type: "ready" }));
  }

  postMessage(text: string): void {
    const request = JSON.parse(text) as WorkerRequest;
    if (request.type === "query") {
      this.queries++;
      this.started.resolve(request.job);
    }
  }

  reply(reply: WorkerReply): void {
    this.emit("message", JSON.stringify(reply));
  }

  terminate(): Promise<void> {
    this.stopping = true;
    return this.stopped.promise;
  }

  exit(): void {
    this.emit("exit", 0);
    this.stopped.resolve();
  }
}

const job: QueryJob = {
  params: {},
  uri: ":memory:",
  source: { id: "source", databasePath: ":memory:" },
  vault: { name: "tests", path: "/tests" },
  scope: MY_LIBRARY_SCOPE,
};

// Failure modes: a late closure receipt is discarded after forced stop starts;
// a dying worker receives another query; pool disposal forgets that worker.
it("accepts a late closure receipt while reserving the stopping process until exit", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const created: WorkerReceipts[] = [];
  const workers = new QueryWorkers(() => {
    const worker = new WorkerReceipts();
    created.push(worker);
    return worker;
  });
  try {
    await workers.ready;
    const first = created[0]!;
    const other = created[1]!;
    const controller = new AbortController();
    const reason = new Error("cancel this query");
    const rejected = expect(
      workers.answer(job, controller.signal),
    ).rejects.toBe(reason);
    await first.started.promise;
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(SLICE_BUDGET_MS);
    expect(first.stopping).toBe(true);

    first.reply({ type: "cancelled" });
    await rejected;
    const next = workers.answer(job, new AbortController().signal);
    await other.started.promise;
    expect(first.queries).toBe(1);
    other.reply({ type: "answer", answer: "complete" });
    await expect(next).resolves.toBe("complete");

    const disposed = workers[Symbol.asyncDispose]();
    let finished = false;
    void disposed.then(() => {
      finished = true;
    });
    other.exit();
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    first.exit();
    await disposed;
  } finally {
    for (const worker of created) worker.exit();
    await workers[Symbol.asyncDispose]();
    vi.useRealTimers();
  }
});

it("gives accepted cleanup the original 50 ms deadline without restarting it", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const created: WorkerReceipts[] = [];
  const workers = new QueryWorkers(() => {
    const worker = new WorkerReceipts();
    created.push(worker);
    return worker;
  });
  try {
    await workers.ready;
    const first = created[0]!;
    const controller = new AbortController();
    const reason = new Error("cancel this query");
    const rejected = expect(
      workers.answer(job, controller.signal),
    ).rejects.toBe(reason);
    await first.started.promise;
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(5);
    first.reply({ type: "cancel-accepted" });
    await vi.advanceTimersByTimeAsync(44);
    expect(first.stopping).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(first.stopping).toBe(true);
    first.reply({ type: "cancelled" });
    await rejected;
  } finally {
    for (const worker of created) worker.exit();
    await workers[Symbol.asyncDispose]();
    vi.useRealTimers();
  }
});

it("rejects a failed replacement startup after its first waiting query was cancelled", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const created: WorkerReceipts[] = [];
  const replacement = Promise.withResolvers<WorkerReceipts>();
  const workers = new QueryWorkers(() => {
    const worker = new WorkerReceipts(created.length < 2);
    created.push(worker);
    if (created.length === 3) replacement.resolve(worker);
    return worker;
  });
  try {
    await workers.ready;
    const first = created[0]!;
    const initial = new AbortController();
    const reason = new Error("cancel this query");
    const initialRejected = expect(
      workers.answer(job, initial.signal),
    ).rejects.toBe(reason);
    await first.started.promise;
    initial.abort(reason);
    await vi.advanceTimersByTimeAsync(SLICE_BUDGET_MS);
    first.exit();
    await initialRejected;
    await vi.advanceTimersByTimeAsync(0);

    const waiting = new AbortController();
    const waitingRejected = expect(
      workers.answer(job, waiting.signal),
    ).rejects.toBe(reason);
    const warming = await replacement.promise;
    waiting.abort(reason);
    await waitingRejected;
    await vi.advanceTimersByTimeAsync(0);

    const failure = new Error("worker startup failed");
    const nextRejected = expect(
      workers.answer(job, new AbortController().signal),
    ).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(0);
    warming.emit("error", failure);
    warming.exit();
    await nextRejected;
    expect(warming.queries).toBe(0);
  } finally {
    for (const worker of created) worker.exit();
    await workers[Symbol.asyncDispose]();
    vi.useRealTimers();
  }
});
