// Runs the guarded production parse bundle in Node, with timing at the message boundary.
import { once } from "node:events";
import { Worker } from "node:worker_threads";

import { scanWorkerBundle } from "./scan-worker-bundle.js";

// The worker's wire shapes, restated: the Node program cannot load renderer
// source. `citation-parse/worker.ts` owns them, and the bench names the reply.
interface ParseRequest {
  path: string;
  generation: number;
  text: string;
}

type WorkerReply = { id: number; json: string } | { id: number; error: string };

export async function scanBenchmarkWorker<ParseReply>() {
  const source = await scanWorkerBundle();
  const worker = new Worker(
    `
    const { parentPort } = require("node:worker_threads");
    let start;
    globalThis.self = {
      addEventListener: (_, listener) => parentPort.on("message", data => {
        start = performance.now(); listener({ data });
      }),
      postMessage: data => parentPort.postMessage({data, workerMs: performance.now() - start}),
    };
    ${source}
  `,
    { eval: true },
  );
  await once(worker, "online");
  let sequence = 0;
  let receivedAt = 0;
  let workerMs = 0;
  const pending = new Map<number, PromiseWithResolvers<ParseReply>>();
  worker.on("message", (message: { data: WorkerReply; workerMs: number }) => {
    receivedAt = performance.now();
    workerMs = message.workerMs;
    const waiter = pending.get(message.data.id);
    pending.delete(message.data.id);
    if ("error" in message.data) waiter?.reject(new Error(message.data.error));
    else waiter?.resolve(JSON.parse(message.data.json) as ParseReply);
  });
  worker.on("error", (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  return {
    get receivedAt() {
      return receivedAt;
    },
    get workerMs() {
      return workerMs;
    },
    parse(request: ParseRequest, signal: AbortSignal): Promise<ParseReply> {
      signal.throwIfAborted();
      const id = ++sequence;
      const waiter = Promise.withResolvers<ParseReply>();
      pending.set(id, waiter);
      worker.postMessage({ id, request });
      return waiter.promise;
    },
    async [Symbol.asyncDispose]() {
      await worker.terminate();
    },
  };
}
