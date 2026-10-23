// Runs the production RPC worker in Node, timing receipt through reply posting.
import type { RpcMessage } from "effect/rpc";
import type { Worker as EffectWorker } from "effect/workers";
import { Worker } from "node:worker_threads";

import { scanWorkerBundle } from "./scan-worker-bundle.js";

interface TimedMessage {
  data: EffectWorker.PlatformMessage;
  workerMs?: number;
}

export async function scanBenchmarkWorker<ParseReply>() {
  const bundle = await scanWorkerBundle<ParseReply>();
  await using stack = new AsyncDisposableStack();
  const workers = stack.use(new AsyncDisposableStack());
  let receivedAt = 0;
  let workerMs = 0;
  let encodeMs = 0;
  let postMs = 0;
  // Start the Node worker inside the RPC spawner so its ready message cannot
  // arrive before the EventTarget bridge has an RPC listener.
  const client = stack.use(
    await bundle.connect(
      () => {
        const worker = workers.use(
          new Worker(
            `
        const { parentPort } = require("node:worker_threads");
        const starts = new Map();
        // Measure before the runner receives a request; measure its matching Exit
        // before posting. Handshakes and cancellation never replace another timer.
        parentPort.on("message", data => {
          if (data[0] === 0 && data[1]?._tag === "Request") starts.set(data[1].id, performance.now());
          if (data[0] === 0 && data[1]?._tag === "Interrupt") starts.delete(data[1].requestId);
        });
        const post = parentPort.postMessage.bind(parentPort);
        parentPort.postMessage = (data, options) => {
          const reply = data[0] === 1 ? data[1] : undefined;
          const start = reply?._tag === "Exit" ? starts.get(reply.requestId) : undefined;
          const workerMs = start === undefined ? undefined : performance.now() - start;
          if (reply?._tag === "Exit") starts.delete(reply.requestId);
          post({ data, workerMs }, options);
        };
        globalThis.self = parentPort;
        ${bundle.default}
      `,
            { eval: true },
          ),
        );
        const events = new EventTarget();
        const port = {
          addEventListener: events.addEventListener.bind(events),
          removeEventListener: events.removeEventListener.bind(events),
          postMessage: (data: [number, RpcMessage.FromClientEncoded?]) => {
            const start = performance.now();
            worker.postMessage(data);
            if (data[0] === 0 && data[1]?._tag === "Request")
              postMs = encodeMs + performance.now() - start;
          },
        };
        worker.on("message", (message: TimedMessage) => {
          const reply =
            message.data[0] === 1
              ? (message.data[1] as RpcMessage.FromServerEncoded)
              : undefined;
          if (reply?._tag === "Exit") {
            receivedAt = performance.now();
            workerMs = message.workerMs ?? 0;
          }
          events.dispatchEvent(
            new MessageEvent("message", { data: message.data }),
          );
        });
        worker.on("error", (error) => {
          events.dispatchEvent(
            Object.assign(new Event("error"), {
              error,
              message: String(error),
            }),
          );
        });
        return port;
      },
      (milliseconds) => {
        encodeMs = milliseconds;
      },
    ),
  );
  const resources = stack.move();
  return {
    get receivedAt() {
      return receivedAt;
    },
    get postMs() {
      return postMs;
    },
    get workerMs() {
      return workerMs;
    },
    parse: client.parse,
    [Symbol.asyncDispose]: () => resources[Symbol.asyncDispose](),
  };
}
