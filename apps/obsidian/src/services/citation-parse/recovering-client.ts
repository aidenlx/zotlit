// Owns scoped worker recovery and bounded requests across connection lifetimes.
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Ref,
  Schedule,
  Scope,
} from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import { isScopeClosed } from "@/lib/effect-scope";

import { ParseFailed } from "./client";
import type { ParseClient, ParseRequest, ParseWorkerDied } from "./client";
import type { ParseConnection } from "./worker-host";

// boundary: Deferred.await is the Effect wait primitive; the audit pattern includes its name.
const awaitDeferred = Deferred.await;

export interface RecoveringParseClient extends ParseClient {
  start(): Effect.Effect<void>;
}

export const makeRecoveringParseClient = Effect.fnUntraced(function* (
  connect: Effect.Effect<ParseConnection, ParseWorkerDied, Scope.Scope>,
): Effect.fn.Return<RecoveringParseClient, never, Scope.Scope> {
  const lifetimeScope = yield* Effect.scope;
  type Live = {
    readonly connection: ParseConnection;
    readonly replaced: Deferred.Deferred<void>;
    readonly scope: Scope.Closeable;
  };
  const available = yield* Ref.make(Deferred.makeUnsafe<Live>());
  const started = yield* Ref.make(false);

  const serve = Effect.gen(function* () {
    const attemptScope = yield* Scope.Scope;
    const connectionScope = yield* Scope.fork(attemptScope);
    const connection = yield* Scope.provide(connect, connectionScope);
    const replaced = yield* Deferred.make<void>();
    yield* Deferred.succeed(yield* Ref.get(available), {
      connection,
      replaced,
      scope: connectionScope,
    });
    const death = yield* connection.died;
    // Publish the new wait before releasing requests from the dead connection.
    yield* Ref.set(available, Deferred.makeUnsafe<Live>());
    yield* Deferred.succeed(replaced, undefined);
    yield* Scope.close(connectionScope, Exit.void);
    return yield* Effect.fail(death);
  }).pipe(
    Effect.scoped,
    Effect.tapError((error) =>
      Effect.logWarning("Parse worker stopped; restarting").pipe(
        Effect.annotateLogs({ error }),
        withLogCategory("citation-parse"),
      ),
    ),
  );

  const parse = Effect.fnUntraced(function* (request: ParseRequest) {
    if (isScopeClosed(lifetimeScope)) {
      return yield* Effect.fail(
        new ParseFailed({ message: "Parse worker unavailable" }),
      );
    }
    const live = yield* awaitDeferred(yield* Ref.get(available)).pipe(
      Effect.timeoutOrElse({
        duration: "15 seconds",
        orElse: () =>
          Effect.fail(new ParseFailed({ message: "Parse worker unavailable" })),
      }),
    );
    const attempt = live.connection.parse(request).pipe(
      Effect.timeoutOrElse({
        duration: "15 seconds",
        orElse: () =>
          Scope.close(live.scope, Exit.void).pipe(
            Effect.andThen(awaitDeferred(live.replaced)),
            Effect.andThen(
              Effect.fail(
                new ParseFailed({ message: "Citation parse timed out" }),
              ),
            ),
          ),
      }),
      Effect.catchTag("ParseWorkerDied", (error) =>
        Effect.andThen(awaitDeferred(live.replaced), Effect.fail(error)),
      ),
    );
    // The connection deadline belongs to its scope, not a caller that abandons the note.
    const fiber = yield* attempt.pipe(
      Effect.forkIn(lifetimeScope, { startImmediately: true }),
    );
    return yield* Fiber.join(fiber);
  });

  return {
    start: Effect.fn("RecoveringParseClient.start")(function* () {
      if (isScopeClosed(lifetimeScope)) return;
      if (yield* Ref.getAndSet(started, true)) return;
      yield* serve.pipe(
        Effect.retry(
          Schedule.min([
            Schedule.exponential("100 millis"),
            Schedule.spaced("5 seconds"),
          ]),
        ),
        Effect.forkIn(lifetimeScope, { startImmediately: true }),
      );
    }),
    parse,
  };
});
