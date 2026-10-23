import { Effect, Fiber } from "@/lib/effect";

/** Bound plugin startup while the first external read continues on its Scope. */
export const startupBarrier = Effect.fn("startupBarrier")(function* <R, R2>(
  load: Effect.Effect<void, never, R>,
  onTimeout: Effect.Effect<void, never, R2>,
) {
  const pending = yield* Effect.forkScoped(load, { startImmediately: true });
  // Time out only the join: interrupting the read would discard its late result.
  yield* Fiber.join(pending).pipe(
    Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => onTimeout }),
  );
});
