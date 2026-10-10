// One worker-owned refresh lane, shared by requests for a source generation.
import { Deferred, Effect, Ref, Scope } from "effect";

import { getLogger } from "@/lib/log";

import { toDbUnavailable } from "./connection";
import type { Connection } from "./connection";
import type { CitationSource, DbUnavailable, ReadsConfig } from "./rpc";

const logger = getLogger("citation-index");

interface Lane {
  source: CitationSource;
  done: Deferred.Deferred<number, DbUnavailable>;
  active: boolean;
}

export const makeCitationRefresh = Effect.fnUntraced(function* (
  connection: Connection["Service"],
  configure: (config: ReadsConfig) => Effect.Effect<void>,
) {
  const lifetime = yield* Scope.Scope;
  const state = yield* Ref.make<Lane | undefined>(undefined);

  const run = Effect.fnUntraced(function* () {
    while (true) {
      const { source } = (yield* Ref.get(state))!;
      const result = yield* Effect.result(
        configure(source.config).pipe(
          Effect.andThen(connection.refresh),
          Effect.catchDefect((cause) => Effect.fail(toDbUnavailable(cause))),
        ),
      );
      const trailing = yield* Ref.modify(state, (current) => {
        const lane = current!;
        if (lane.source.generation > source.generation)
          return [lane.source.generation, lane] as const;
        return [null, { ...lane, active: false }] as const;
      });
      if (trailing !== null) {
        logger.debug("Citation refresh has a trailing generation", {
          generation: source.generation,
          nextGeneration: trailing,
          outcome: result._tag,
        });
        continue;
      }
      if (result._tag === "Failure") return yield* result.failure;
      return source.generation;
    }
  });

  const refresh = Effect.fnUntraced(function* (source: CitationSource) {
    while (true) {
      // Admission and fork form one interruption-safe step. A caller owns
      // only its wait; the worker scope owns the refresh and its completion.
      const lane = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const done = yield* Deferred.make<number, DbUnavailable>();
          const { lane, start } = yield* Ref.modify(state, (current) => {
            if (current && source.generation <= current.source.generation)
              return [{ lane: current, start: false }, current] as const;
            const lane: Lane = current?.active
              ? { ...current, source }
              : { source, done, active: true };
            return [{ lane, start: !current?.active }, lane] as const;
          });
          if (start) {
            yield* Effect.forkIn(
              run().pipe(
                Effect.onExit((exit) =>
                  Ref.update(state, (current) =>
                    current?.done === lane.done
                      ? { ...current, active: false }
                      : current,
                  ).pipe(Effect.andThen(Deferred.done(lane.done, exit))),
                ),
              ),
              lifetime,
              { startImmediately: false },
            );
          } else if (lane.active) {
            logger.debug("Citation request joins a refresh", {
              generation: source.generation,
              requestedGeneration: lane.source.generation,
            });
          }
          return lane;
        }),
      );
      const result = yield* Effect.result(Deferred.await(lane.done));
      const current = (yield* Ref.get(state))!;
      if (current.done !== lane.done) {
        logger.debug("Citation refresh completion superseded", {
          generation: lane.source.generation,
          nextGeneration: current.source.generation,
        });
        continue;
      }
      if (result._tag === "Failure") return yield* result.failure;
      return result.success;
    }
  });

  return {
    refresh,
    generation: Effect.map(Ref.get(state), (lane) => lane?.source.generation),
  };
});
