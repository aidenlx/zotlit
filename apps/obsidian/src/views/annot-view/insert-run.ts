// The Effect side of an annotation insert by command or by drag: each insert
// runs as one fiber on the view's runner, so a cancelled destination or a
// closed view interrupts it.
import { Cause, Effect, Exit } from "effect";
import type { Fiber } from "effect";

import { withLogCategory } from "@/lib/effect-log";
import type {
  AnnotationInsertOutcome,
  AnnotationInsertRequest,
} from "@/services/note-feature/insert-action";

import type { captureInsertion } from "./async-insert";

type InsertionTarget = ReturnType<typeof captureInsertion>;

/** An insert in flight; interrupting it stops the insert with no notice. */
export type InsertFiber = Fiber.Fiber<AnnotationInsertOutcome>;

/** Where an insert runs; `R` is the services its Effects run with. */
export interface InsertRunner<R> {
  /** The insert itself: it reads the annotation and commits into `target`. */
  execute: (
    request: AnnotationInsertRequest,
  ) => Effect.Effect<AnnotationInsertOutcome, unknown, R>;
  /**
   * Forks an insert on the view's lifetime: closing the view interrupts
   * every insert it started.
   */
  run: <A>(effect: Effect.Effect<A, never, R>) => Fiber.Fiber<A>;
}

/** An insert that ends before it starts, with `outcome`, which `report` shows. */
export function endInsert<R>(
  runner: InsertRunner<R>,
  outcome: AnnotationInsertOutcome,
  report: (outcome: AnnotationInsertOutcome) => AnnotationInsertOutcome,
): InsertFiber {
  return runner.run(Effect.sync(() => report(outcome)));
}

/**
 * Captures the destination for the insert and runs it, interrupted when the
 * destination is cancelled (Escape, an overlapping edit, a switch of note).
 * `report` shows the outcome. A failure the insert did not fold into its
 * outcome is logged and reads as a failed insert.
 */
export function startInsert<R>(
  runner: InsertRunner<R>,
  options: {
    capture: () => InsertionTarget;
    request: (target: InsertionTarget) => AnnotationInsertRequest;
    report: (outcome: AnnotationInsertOutcome) => AnnotationInsertOutcome;
  },
): InsertFiber {
  const { report } = options;
  return runner.run(
    Effect.gen(function* () {
      const target = yield* Effect.acquireDisposable(
        Effect.sync(options.capture),
      );
      const cancelled = Effect.callback<never>((resume) => {
        const release = target.onCancel(() => resume(Effect.interrupt));
        return Effect.sync(release);
      });
      const exit = yield* Effect.exit(
        Effect.raceFirst(runner.execute(options.request(target)), cancelled),
      );
      if (Exit.isSuccess(exit)) return report(exit.value);
      if (Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.interrupt;
      yield* Effect.logWarning("Annotation insert failed").pipe(
        Effect.annotateLogs({ error: Cause.squash(exit.cause) }),
      );
      return report({ kind: "failed" });
    }).pipe(Effect.scoped, withLogCategory("views", "annot-view")),
  );
}
