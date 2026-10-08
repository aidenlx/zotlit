// This entry is bundled independently. It runs in an Electron utility
// process; Node workers exercise the same entry in tests.
import { configureSync, getLogger } from "@logtape/logtape";
import { open } from "node:fs/promises";
import { parentPort } from "node:worker_threads";

import { createClient } from "@zotlit/db/client/node";

import {
  createItemQueryHandler,
  diagnostic,
  failure,
  ITEM_QUERY_COMMAND,
} from "./cli";
import { createTrace, finishTrace } from "./trace";
import type { CancellationEvent, WorkerMeasurement } from "./trace";
import type { QueryJob, WorkerReply, WorkerRequest } from "./worker-protocol";

// A utility process is parented by Electron's main process. End it if its
// owning vault renderer crashes, even while the rest of Obsidian stays open.
if (process.parentPort) {
  const owner = Number(process.argv[2]);
  if (!Number.isSafeInteger(owner) || owner <= 0)
    throw new Error("Item Query process has no owner");
  setInterval(() => {
    try {
      process.kill(owner, 0);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH")
        process.exit(0);
    }
  }, 1000).unref();
}

const port = process.parentPort ?? parentPort;
if (!port) throw new Error("Item Query worker has no parent port");
const send = (reply: WorkerReply) =>
  port.postMessage(
    JSON.stringify(reply, (_key, value: unknown) => {
      if (typeof value === "bigint") return String(value);
      if (value instanceof Error)
        return {
          ...Object.fromEntries(Object.entries(value)),
          name: value.name,
          message: value.message,
          stack: value.stack,
          cause: value.cause,
        };
      return value;
    }),
  );
configureSync({
  sinks: { parent: (record) => send({ type: "log", record }) },
  loggers: [
    { category: ["zotlit"], lowestLevel: "debug", sinks: ["parent"] },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["parent"],
    },
  ],
});

let active: AbortController | undefined;
const receive = (text: string) => {
  const request = JSON.parse(text) as WorkerRequest;
  if (request.type === "cancel") {
    active?.abort();
    return;
  }
  const controller = new AbortController();
  active = controller;
  const progress = (phase: CancellationEvent["phase"]) => {
    if (request.job.measure)
      send({
        type: "cancel-progress",
        event: { phase, atEpochMs: Temporal.Now.instant().epochMilliseconds },
      });
  };
  controller.signal.addEventListener(
    "abort",
    () => {
      progress("received");
      send({ type: "cancel-accepted" });
    },
    { once: true },
  );
  void answer(request.job, controller.signal, progress)
    .then(
      (result) => {
        if (controller.signal.aborted) progress("resources-closed");
        send(
          controller.signal.aborted
            ? { type: "cancelled" }
            : { type: "answer", ...result },
        );
      },
      (error: unknown) => {
        if (controller.signal.aborted) {
          // answer() has closed SQLite and its output files before this receipt.
          progress("resources-closed");
          send({ type: "cancelled" });
          return;
        }
        const caught =
          error instanceof Error ? error : new Error(String(error));
        send({
          type: "error",
          name: caught.name,
          message: caught.message,
          stack: caught.stack,
        });
      },
    )
    .finally(() => {
      active = undefined;
    });
};
if (process.parentPort)
  process.parentPort.on("message", ({ data }: { data: string }) =>
    receive(data),
  );
else parentPort!.on("message", receive);
send({ type: "ready" });

async function answer(
  job: QueryJob,
  signal: AbortSignal,
  progress: (phase: CancellationEvent["phase"]) => void,
): Promise<{ answer: string; measurement?: WorkerMeasurement }> {
  using measurement = measureChannels(job.measure ?? false);
  const startedAt = performance.timeOrigin + performance.now();
  const trace = job.measure ? createTrace(job.heap ?? false) : undefined;
  const answerSteps: number[] = [];
  const heapBefore = process.memoryUsage().heapUsed;
  // The parent holds the lease until this connection closes or the worker exits.
  let client;
  try {
    client = createClient(job.uri, {
      connection: { readOnly: true },
      jit: true,
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ERR_SQLITE_ERROR"
    )
      throw error;
    getLogger(["zotlit", "obsidian", "item-query"]).warn(
      "Item Query could not reopen its leased database",
      { error },
    );
    return {
      answer: failure(
        ITEM_QUERY_COMMAND,
        diagnostic("source-unavailable", error.message),
      ),
    };
  }
  using _connection = client.$client;
  await using outputFiles = new AsyncDisposableStack();
  const handler = createItemQueryHandler({
    acquireRead: async () => ({
      client,
      uri: job.uri,
      source: job.source,
      [Symbol.dispose]: () => {},
    }),
    vault: () => job.vault,
    libraryScope: async () => job.scope,
    signal,
    instrument: trace?.instrument,
    onAnswerStep: job.measure ? (ms) => answerSteps.push(ms) : undefined,
    openOutput: async (_path) => {
      if (!job.stagePath)
        throw new Error("Item Query export has no staging path");
      const file = outputFiles.adopt(
        await open(job.stagePath, "wx", 0o600),
        async (file) => {
          await file.close();
          if (signal.aborted) progress("files-closed");
        },
      );
      return {
        write: async (text) => {
          try {
            await file.writeFile(text, "utf8");
          } finally {
            if (signal.aborted) progress("write-finished");
          }
        },
        close: () => file.close(),
      };
    },
  });
  const text = await handler(job.params);
  if (!trace) return { answer: text };
  return {
    answer: text,
    measurement: {
      ...finishTrace(trace, {
        startedAt,
        answerSteps,
        heapBefore: job.heap ? heapBefore : undefined,
      }),
      channels: measurement.count,
    },
  };
}

/** Count scheduler channels in the process that actually runs the query. */
function measureChannels(enabled: boolean) {
  const Original = globalThis.MessageChannel;
  const count = { created: 0, closed: 0, open: 0 };
  if (enabled)
    globalThis.MessageChannel = class extends Original {
      constructor() {
        super();
        count.created++;
        count.open++;
        const close = this.port1.close.bind(this.port1);
        let closed = false;
        this.port1.close = () => {
          if (!closed) {
            count.closed++;
            count.open--;
            closed = true;
          }
          close();
        };
      }
    };
  return {
    count: enabled ? count : undefined,
    [Symbol.dispose]: () => {
      if (enabled) globalThis.MessageChannel = Original;
    },
  };
}
