// Owns scoped worker recovery and bounded requests across connection lifetimes.
import { Deferred, Effect, Fiber, Schedule } from "@/lib/effect";
import type { Scope } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";

import { ParseFailed, ParseWorkerDied } from "./client";
import type { ParseClient, ParseRequest } from "./client";

export interface ParseConnection extends ParseClient, Disposable {
  /** Resolves when this connection can no longer serve requests. */
  died: Promise<void>;
}

export interface RecoveringParseClient extends ParseClient {
  start(): void;
}

export const makeRecoveringParseClient = Effect.fnUntraced(function* (
  connect: Effect.Effect<ParseConnection, ParseWorkerDied, Scope.Scope>,
): Effect.fn.Return<RecoveringParseClient, never, Scope.Scope> {
  const scope = yield* Effect.scope;
  const context = yield* Effect.context<never>();
  const started = yield* Deferred.make<void>();
  type Live = { connection: ParseConnection; retired: Deferred.Deferred<void> };
  let available = Deferred.makeUnsafe<Live>();

  const serve = Effect.gen(function* () {
    const connection = yield* Effect.acquireRelease(connect, (client) =>
      Effect.sync(() => client[Symbol.dispose]()),
    );
    const retired = yield* Deferred.make<void>();
    yield* Deferred.succeed(available, { connection, retired });
    yield* Effect.promise(() => connection.died);
    // Publish the new wait before releasing requests from the dead connection.
    available = Deferred.makeUnsafe<Live>();
    yield* Deferred.succeed(retired, undefined);
    return yield* Effect.fail(new ParseWorkerDied("Parse worker stopped"));
  }).pipe(
    Effect.scoped,
    Effect.tapError((error) =>
      Effect.logWarning("Parse worker stopped; restarting").pipe(
        Effect.annotateLogs({ error }),
        withLogCategory("citation-parse"),
      ),
    ),
    Effect.retry(
      Schedule.min([
        Schedule.exponential("100 millis"),
        Schedule.spaced("5 seconds"),
      ]),
    ),
  );
  yield* Effect.andThen(Deferred.await(started), serve).pipe(
    Effect.forkIn(scope),
  );

  const parse = Effect.fnUntraced(
    function* (request: ParseRequest) {
      const { connection, retired } = yield* Deferred.await(available).pipe(
        Effect.timeoutOrElse({
          duration: "15 seconds",
          orElse: () =>
            Effect.fail(new ParseFailed("Parse worker unavailable")),
        }),
      );
      return yield* Effect.tryPromise({
        try: (signal) => connection.parse(request, signal),
        catch: (error) =>
          error instanceof ParseWorkerDied
            ? error
            : new ParseFailed(String(error)),
      }).pipe(
        Effect.timeoutOrElse({
          duration: "15 seconds",
          orElse: () =>
            Effect.sync(() => connection[Symbol.dispose]()).pipe(
              Effect.andThen(
                Effect.fail(new ParseFailed("Citation parse timed out")),
              ),
            ),
        }),
        // Posted work keeps its deadline even when its caller stops waiting.
        Effect.forkIn(scope),
        Effect.flatMap(Fiber.join),
        Effect.catch((error) =>
          error instanceof ParseWorkerDied
            ? Effect.andThen(Deferred.await(retired), Effect.fail(error))
            : Effect.fail(error),
        ),
      );
    },
    Effect.retry({
      times: 2,
      while: (error) => error instanceof ParseWorkerDied,
    }),
  );

  return {
    start: () => {
      Deferred.doneUnsafe(started, Effect.void);
    },
    parse: (request, signal) =>
      Effect.runPromiseWith(context)(
        parse(request).pipe(
          Effect.tapError((error) =>
            Effect.logWarning("Citation parse abandoned").pipe(
              Effect.annotateLogs({ path: request.path, error }),
              withLogCategory("citation-parse"),
            ),
          ),
          Effect.forkIn(scope),
          Effect.flatMap((fiber) =>
            Fiber.join(fiber).pipe(
              Effect.onInterrupt(() => Fiber.interrupt(fiber)),
            ),
          ),
        ),
        { signal },
      ),
  };
});
