// The Effect side of an annotation insert by command or by drag: each insert
// runs as one fiber on the view's runner, so a cancelled destination or a
// closed view interrupts it. The fiber answers the outcome; the caller shows it.
import { Cause, Effect } from "effect";
import type { Fiber } from "effect";

import { recover } from "@/lib/effect-cause";
import { withLogCategory } from "@/lib/effect-log";
import type { AnnotationRecord } from "@/services/annotation-repository/service";
import type {
  AnnotationInsertOutcome,
  AnnotationInsertRequest,
  AnnotationSnapshot,
} from "@/services/note-feature/insert-action";

import type { captureInsertion } from "./async-insert";

/** An insert in flight; interrupting it stops the insert with no outcome. */
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
  run: <A, E>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>;
}

/**
 * Captures the destination for the insert of `annotation` and runs it,
 * interrupted when the destination is cancelled (Escape, an overlapping edit,
 * a switch of note). A failure the insert did not fold into its outcome is
 * logged and answers a failed insert.
 */
export function startInsert<R>(
  runner: InsertRunner<R>,
  options: {
    annotation: AnnotationRecord;
    snapshot: AnnotationSnapshot;
    notePath: string;
    capture: () => ReturnType<typeof captureInsertion>;
  },
): InsertFiber {
  const { annotation, snapshot, notePath } = options;
  return runner.run(
    Effect.gen(function* () {
      const target = yield* Effect.acquireDisposable(
        Effect.sync(options.capture),
      );
      const cancelled = Effect.callback<never>((resume) => {
        const release = target.onCancel(() => resume(Effect.interrupt));
        return Effect.sync(release);
      });
      return yield* Effect.raceFirst(
        runner.execute({ annotation, snapshot, target, notePath }),
        cancelled,
      );
    }).pipe(
      Effect.scoped,
      recover(
        (cause) =>
          Effect.logWarning("Annotation insert failed").pipe(
            Effect.annotateLogs({
              annotationKey: annotation.key,
              error: Cause.squash(cause),
            }),
          ),
        Effect.succeed<AnnotationInsertOutcome>({ kind: "failed" }),
      ),
      withLogCategory("views", "annot-view"),
    ),
  );
}
