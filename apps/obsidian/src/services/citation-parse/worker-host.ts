// One worker connection; any crash or timeout rejects all work for the recovering client to replay.
import { abortable } from "@std/async/abortable";

import type { ParseReply } from "./client";
import type { ParseConnection } from "./recovering-client";
import type { WorkerReply, WorkerRequest } from "./worker";

const PARSE_TIMEOUT_MS = 15_000;

export function connectParseWorker(source: string): ParseConnection {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  let worker: Worker;
  try {
    worker = new Worker(url, { name: "zotlit-citation-parse" });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  const died = Promise.withResolvers<void>();
  const pending = new Map<number, PromiseWithResolvers<ParseReply>>();
  let sequence = 0;
  let stopped = false;
  const stop = (error: unknown): void => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    URL.revokeObjectURL(url);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    died.resolve();
  };
  worker.addEventListener("error", (event) => stop(new Error(event.message)));
  worker.addEventListener("messageerror", () =>
    stop(new Error("Parse worker message failed")),
  );
  worker.addEventListener("message", ({ data }: MessageEvent<WorkerReply>) => {
    pending.get(data.id)?.resolve(data.reply);
  });
  return {
    died: died.promise,
    async parse(request, signal) {
      signal.throwIfAborted();
      if (stopped) throw new Error("Parse worker stopped");
      const id = ++sequence;
      const result = Promise.withResolvers<ParseReply>();
      pending.set(id, result);
      const timer = setTimeout(
        () => stop(new Error("Parse worker timed out")),
        PARSE_TIMEOUT_MS,
      );
      try {
        worker.postMessage({ id, request } satisfies WorkerRequest);
        return await abortable(result.promise, signal);
      } finally {
        clearTimeout(timer);
        pending.delete(id);
      }
    },
    [Symbol.dispose]: () => stop(new Error("Parse worker disposed")),
  };
}
