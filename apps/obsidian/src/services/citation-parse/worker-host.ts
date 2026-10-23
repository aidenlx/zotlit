// Adapts worker events to individually cancellable Effect requests.
import { Effect } from "@/lib/effect";

import { ParseFailed, ParseWorkerDied } from "./client";
import type { ParseReply } from "./client";
import type { ParseConnection } from "./recovering-client";
import type { WorkerReply, WorkerRequest } from "./worker";

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
  const pending = new Map<
    number,
    (result: Effect.Effect<ParseReply, ParseFailed | ParseWorkerDied>) => void
  >();
  let sequence = 0;
  let stopped = false;
  const stop = (error: ParseWorkerDied): void => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    URL.revokeObjectURL(url);
    for (const resume of pending.values()) resume(Effect.fail(error));
    pending.clear();
    died.resolve();
  };
  worker.addEventListener("error", (event) =>
    stop(new ParseWorkerDied(event.message)),
  );
  worker.addEventListener("messageerror", () =>
    stop(new ParseWorkerDied("Parse worker message failed")),
  );
  worker.addEventListener("message", ({ data }: MessageEvent<WorkerReply>) => {
    const resume = pending.get(data.id);
    pending.delete(data.id);
    resume?.(
      "error" in data
        ? Effect.fail(new ParseFailed(data.error))
        : Effect.succeed(data.reply),
    );
  });
  return {
    died: died.promise,
    parse: (request, signal) =>
      Effect.runPromise(
        Effect.callback<ParseReply, ParseFailed | ParseWorkerDied>((resume) => {
          if (stopped) {
            resume(Effect.fail(new ParseWorkerDied("Parse worker stopped")));
            return;
          }
          const id = ++sequence;
          pending.set(id, resume);
          try {
            worker.postMessage({ id, request } satisfies WorkerRequest);
          } catch (error) {
            pending.delete(id);
            resume(Effect.fail(new ParseFailed(String(error))));
          }
          return Effect.sync(() => {
            pending.delete(id);
          });
        }),
        { signal },
      ),
    [Symbol.dispose]: () => stop(new ParseWorkerDied("Parse worker disposed")),
  };
}
