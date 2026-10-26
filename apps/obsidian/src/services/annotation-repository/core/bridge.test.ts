// The database batch of the Annotation Repository core: what it answers to a key it did not find, and to callers that left before it started.
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, FiberSet, RequestResolver } from "effect";
import { TestClock } from "effect/testing";

import {
  scopedStack,
  setup,
} from "@/services/annotation-repository/__fixtures__";
import type { ZoteroReadsApi } from "@/services/zotero-reads/service";

import { databaseRows, databaseRowsResolver } from "./bridge";

/**
 * The batch over the Fixture's database, each Snapshot a counted lease, on
 * fibers of the case's Scope.
 *
 * @param answer what the Snapshot's reads answer, from the Fixture's own.
 */
const batchOver = Effect.fnUntraced(function* (
  answer: (reads: ZoteroReadsApi) => ZoteroReadsApi = (reads) => reads,
) {
  const stack = yield* scopedStack;
  const { acquireRead } = yield* Effect.promise(() => setup(stack));
  const fibers = yield* FiberSet.make();
  const core = {
    databaseGeneration: 1,
    databaseRows: databaseRowsResolver(
      {
        snapshot: Effect.acquireDisposable(
          Effect.promise(() => acquireRead()),
        ).pipe(Effect.map((lease) => answer(lease.reads))),
      },
      fibers,
    ),
  };
  return { core, acquireRead };
});

describe("databaseRows", () => {
  it.effect("dies for a key the batch read did not answer", () =>
    Effect.gen(function* () {
      const { core, acquireRead } = yield* batchOver(
        (reads) =>
          new Proxy(reads, {
            get(target, key, receiver) {
              return key === "AnnotationsOfAttachments"
                ? () => Effect.succeed([])
                : Reflect.get(target, key, receiver);
            },
          }),
      );

      const exit = yield* Effect.exit(databaseRows(core, "RGRPDF24"));

      expect(acquireRead).toHaveBeenCalledTimes(1);
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
    }),
  );

  it.effect(
    "takes no Snapshot when every caller left before the batch started",
    () =>
      Effect.gen(function* () {
        const batch = yield* batchOver();
        const { acquireRead } = batch;
        // The batch waits one second of the TestClock before it starts.
        const core = {
          ...batch.core,
          databaseRows: RequestResolver.setDelay(
            batch.core.databaseRows,
            "1 second",
          ),
        };

        const first = yield* Effect.forkChild(databaseRows(core, "RGRPDF24"), {
          startImmediately: true,
        });
        const second = yield* Effect.forkChild(databaseRows(core, "EPUBBKS2"), {
          startImmediately: true,
        });
        yield* Fiber.interrupt(first);
        yield* Fiber.interrupt(second);
        // Past the batch's delay: a batch still standing would read now.
        yield* TestClock.adjust("1 second");

        expect(acquireRead).not.toHaveBeenCalled();
        // The same asks, left to run, take one Snapshot for both.
        const both = yield* Effect.forkChild(
          Effect.all(
            [databaseRows(core, "RGRPDF24"), databaseRows(core, "EPUBBKS2")],
            { concurrency: "unbounded" },
          ),
          { startImmediately: true },
        );
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(both);
        expect(acquireRead).toHaveBeenCalledTimes(1);
      }),
  );
});
