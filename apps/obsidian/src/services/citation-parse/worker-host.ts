// Owns one RPC connection; recovering-client owns replacement after a death.
import { Deferred, Effect } from "effect";
import type { Scope } from "effect";

import { decodeParseReply, ParseFailed, ParseWorkerDied } from "./client";
import type { ParseRequest, ParseReply } from "./client";
import { makeParseWorkerClient } from "./worker-client";

class EarlyMessageWorker extends EventTarget {
  readonly #worker: Worker;
  readonly #earlyMessages: unknown[] = [];
  #listening = false;

  constructor(worker: Worker) {
    super();
    this.#worker = worker;
    worker.addEventListener("message", (event) => {
      if (!this.#listening) {
        this.#earlyMessages.push(event.data);
        return;
      }
      this.dispatchEvent(new MessageEvent("message", { data: event.data }));
    });
    worker.addEventListener("error", (event) => {
      this.dispatchEvent(
        new ErrorEvent("error", {
          message: event.message,
          error: event.error,
        }),
      );
    });
  }

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
    if (type !== "message" || this.#listening) return;
    this.#listening = true;
    for (const data of this.#earlyMessages.splice(0))
      this.dispatchEvent(new MessageEvent("message", { data }));
  }

  postMessage(message: unknown, options?: StructuredSerializeOptions): void {
    this.#worker.postMessage(message, options);
  }

  terminate(): void {
    this.#worker.terminate();
  }
}

export interface ParseConnection {
  readonly died: Effect.Effect<ParseWorkerDied>;
  readonly parse: (
    request: ParseRequest,
  ) => Effect.Effect<ParseReply, ParseWorkerDied | ParseFailed>;
}

export const connectParseWorker = Effect.fnUntraced(function* (
  source: string,
): Effect.fn.Return<ParseConnection, ParseWorkerDied, Scope.Scope> {
  const url = yield* Effect.acquireRelease(
    Effect.sync(() =>
      URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
    ),
    (url) => Effect.sync(() => URL.revokeObjectURL(url)),
  );
  const death = yield* Deferred.make<ParseWorkerDied>();
  // boundary: Dedicated workers require terminate(); the platform layer closes only its port.
  const worker = yield* Effect.acquireRelease(
    Effect.try({
      try: () => new Worker(url, { name: "zotlit-citation-parse" }),
      catch: (error) => new ParseWorkerDied({ message: String(error) }),
    }),
    (worker) => Effect.sync(() => worker.terminate()),
  );
  const stop = (error: ParseWorkerDied): void => {
    Deferred.doneUnsafe(death, Effect.succeed(error));
  };
  yield* Effect.addFinalizer(() =>
    Effect.sync(() =>
      stop(new ParseWorkerDied({ message: "Parse worker disposed" })),
    ),
  );
  // boundary: Worker error events have no Effect hook; BrowserWorker owns the platform listeners.
  worker.addEventListener("error", (event) =>
    stop(new ParseWorkerDied({ message: event.message })),
  );
  worker.addEventListener("messageerror", () =>
    stop(new ParseWorkerDied({ message: "Parse worker message failed" })),
  );
  // boundary: Worker messages can arrive before Effect's protocol listener attaches.
  const workerPort = new EarlyMessageWorker(worker);
  const client = yield* makeParseWorkerClient(
    () => workerPort as unknown as Worker,
  ).pipe(
    Effect.mapError((error) => new ParseWorkerDied({ message: String(error) })),
  );
  return {
    died: Deferred.await(death),
    parse: (request) =>
      Effect.raceFirst(
        Deferred.await(death).pipe(Effect.flatMap(Effect.fail)),
        client.Parse(request).pipe(
          Effect.mapError(
            (error) => new ParseFailed({ message: String(error) }),
          ),
          Effect.flatMap((json) =>
            Effect.try({
              try: () => decodeParseReply(json),
              catch: (error) => new ParseFailed({ message: String(error) }),
            }),
          ),
          Effect.catchCause((cause) =>
            Effect.flatMap(Deferred.isDone(death), (stopped) =>
              stopped
                ? Effect.flatMap(
                    Deferred.await(death),
                    (
                      error,
                    ): Effect.Effect<never, ParseWorkerDied | ParseFailed> =>
                      Effect.fail(error),
                  )
                : Effect.failCause(cause),
            ),
          ),
        ),
      ),
  };
});
