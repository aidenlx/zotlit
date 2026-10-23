// Owns one RPC connection; recovering-client owns replacement after a death.
import { Deferred, Effect } from "@/lib/effect";
import type { Scope } from "@/lib/effect";

import { ParseFailed, ParseWorkerDied } from "./client";
import type { ParseConnection } from "./recovering-client";
import { makeParseWorkerClient } from "./worker-client";

export const connectParseWorker = Effect.fnUntraced(function* (
  source: string,
): Effect.fn.Return<ParseConnection, ParseWorkerDied, Scope.Scope> {
  const url = yield* Effect.acquireRelease(
    Effect.sync(() =>
      URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
    ),
    (url) => Effect.sync(() => URL.revokeObjectURL(url)),
  );
  const died = Promise.withResolvers<void>();
  const death = yield* Deferred.make<never, ParseWorkerDied>();
  let stopped = false;
  const worker = yield* Effect.try({
    try: () => new Worker(url, { name: "zotlit-citation-parse" }),
    catch: (error) => new ParseWorkerDied(String(error)),
  });
  const stop = (error: ParseWorkerDied): void => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    Deferred.doneUnsafe(death, Effect.fail(error));
    died.resolve();
  };
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => stop(new ParseWorkerDied("Parse worker disposed"))),
  );
  worker.addEventListener("error", (event) =>
    stop(new ParseWorkerDied(event.message)),
  );
  worker.addEventListener("messageerror", () =>
    stop(new ParseWorkerDied("Parse worker message failed")),
  );
  const client = yield* makeParseWorkerClient(() => worker).pipe(
    Effect.mapError((error) => new ParseWorkerDied(String(error))),
  );
  const context = yield* Effect.context<never>();
  return {
    died: died.promise,
    parse: (request, signal) =>
      Effect.runPromiseWith(context)(
        Effect.suspend(() =>
          stopped
            ? Effect.fail(new ParseWorkerDied("Parse worker stopped"))
            : client.Parse(request).pipe(
                Effect.mapError((error) => new ParseFailed(String(error))),
                Effect.raceFirst(Deferred.await(death)),
              ),
        ),
        { signal },
      ),
    [Symbol.dispose]: () => stop(new ParseWorkerDied("Parse worker disposed")),
  };
});
