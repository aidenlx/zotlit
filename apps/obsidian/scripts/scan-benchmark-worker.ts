// Runs the guarded production parse bundle in Node, with timing at the message boundary.
import { once } from "node:events";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { build } from "vite";

import type {
  ParseReply,
  ParseRequest,
} from "../src/services/citation-parse/client.js";
import type { WorkerReply } from "../src/services/citation-parse/worker.js";
import { embeddedWorker } from "./embedded-worker.js";

export async function scanBenchmarkWorker() {
  const packageRoot = resolve(import.meta.dirname, "..");
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "scan-benchmark-entry",
        resolveId: (id) => (id === "virtual:scan-benchmark" ? id : null),
        load: (id) =>
          id === "virtual:scan-benchmark"
            ? 'export { default } from "virtual:scan-worker";'
            : null,
      },
      embeddedWorker({
        id: "virtual:scan-worker",
        entry: resolve(packageRoot, "src/services/citation-parse/worker.ts"),
        config: {
          resolve: { alias: { "@": resolve(packageRoot, "src") } },
          external: [],
          minify: false,
          sourcemap: false,
          target: "es2025",
        },
      }),
    ],
    build: {
      write: false,
      lib: { entry: "virtual:scan-benchmark", formats: ["es"] },
      rolldownOptions: { input: "virtual:scan-benchmark" },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const chunk = outputs
    .flatMap((output) => ("output" in output ? output.output : []))
    .find((output) => output.type === "chunk");
  if (!chunk) throw new Error("Scanner worker bundle emitted no JavaScript");
  const bundled = (await import(
    `data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`
  )) as { default: string };
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
    ${bundled.default}
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
    else waiter?.resolve(message.data.reply);
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
