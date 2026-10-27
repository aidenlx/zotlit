import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import { stubService } from "@/lib/__fixtures__/service-stub";

import { openExcerptFile } from "./file";

// #1790: the platform keeps late file handles, while crop teardown stays bounded.
it.effect(
  "bounds a cancelled open and closes the handle when it arrives later",
  () =>
    Effect.gen(function* () {
      const opening = yield* Deferred.make<FileSystem.File>();
      const started = yield* Deferred.make<void>();
      const closed = yield* Deferred.make<void>();
      const platform = Layer.succeed(
        FileSystem.FileSystem,
        FileSystem.makeNoop({
          open: () =>
            Effect.acquireRelease(
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Deferred.await(opening)),
              ),
              () => Deferred.succeed(closed, undefined),
            ),
        }),
      );
      const fiber = yield* openExcerptFile("/late.pdf").pipe(
        Effect.scoped,
        Effect.provide(platform),
        Effect.forkChild,
      );
      yield* Deferred.await(started);
      const interrupted = yield* Fiber.interrupt(fiber).pipe(Effect.forkChild);
      yield* TestClock.adjust(5_000);
      yield* Fiber.join(interrupted);
      expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true);
      yield* Deferred.succeed(
        opening,
        stubService<FileSystem.File>("Late PDF", {}),
      );
      yield* Deferred.await(closed);
    }),
);

it.effect("bounds a file close while its cleanup keeps ownership", () =>
  Effect.gen(function* () {
    const closing = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const closed = yield* Deferred.make<void>();
    const platform = Layer.succeed(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        open: () =>
          Effect.acquireRelease(
            Effect.succeed(stubService<FileSystem.File>("PDF", {})),
            () =>
              Deferred.succeed(closing, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.andThen(Deferred.succeed(closed, undefined)),
              ),
          ),
      }),
    );
    const fiber = yield* openExcerptFile("/paper.pdf").pipe(
      Effect.scoped,
      Effect.provide(platform),
      Effect.forkChild,
    );
    yield* Deferred.await(closing);
    yield* TestClock.adjust(5_000);
    yield* Fiber.join(fiber);
    expect(yield* Deferred.isDone(closed)).toBe(false);
    yield* Deferred.succeed(release, undefined);
    yield* Deferred.await(closed);
  }),
);
