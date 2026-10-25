import { expect } from "vitest";

import { Deferred, Effect, Exit, Scope } from "@/lib/effect";
import { makeInMemoryRpcProtocols } from "@/lib/effect-rpc-in-process";
import { it } from "@/lib/effect-vitest";

// #1739: an Ack reaches the server on a later microtask (#1738). Once the
// pair's scope has closed, that microtask must deliver nothing. The server
// reads in a longer scope here: in the consumers' wiring its reader stops with
// the pair, and the protocol buffers the late Ack instead, which hides a
// delivery the pair should not make.
it.effect(
  "an Ack still pending when the pair's scope closes never reaches the server",
  () =>
    Effect.gen(function* () {
      const received: Array<string | number> = [];
      const delivered = yield* Deferred.make<void>();
      const pairScope = yield* Scope.make();
      const { server, client } = yield* Scope.provide(
        makeInMemoryRpcProtocols,
        pairScope,
      );
      yield* Effect.forkScoped(
        server.run((_clientId, message) =>
          Effect.andThen(
            Effect.sync(() => {
              if (message._tag === "Ack") received.push(message.requestId);
            }),
            Deferred.succeed(delivered, undefined),
          ),
        ),
      );
      yield* client.send(0, { _tag: "Ack", requestId: "open" });
      yield* Deferred.await(delivered);

      yield* client.send(0, { _tag: "Ack", requestId: "late" });
      yield* Scope.close(pairScope, Exit.void);
      // Microtasks run in order, so this one runs after the late Ack's.
      yield* Effect.promise(
        () => new Promise<void>((resolve) => queueMicrotask(resolve)),
      );
      expect(received).toEqual(["open"]);
    }),
);
