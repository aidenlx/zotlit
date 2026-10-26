// Obsidian notices as a service the Effect layers show their toasts through.
import { Cause, Context, Effect, Exit, Layer, Option } from "effect";
import type { Duration } from "effect";
import type { Scope } from "effect";

import { AbortError } from "@/lib/abort-error";
import { withLogCategory } from "@/lib/effect-log";
import { BaseNotice, LazyNotice } from "@/lib/notice";

/** What a notice shows: plain text, or a fragment from `BaseNotice.render`. */
export type NoticeMessage = string | DocumentFragment;

export interface NoticeOptions {
  /** How long the notice stays, in ms; `0` keeps it until it hides. Obsidian's default when absent. */
  readonly duration?: number;
}

/** A notice on screen. */
export interface NoticeHandle {
  readonly hide: Effect.Effect<void>;
  setMessage(message: NoticeMessage): Effect.Effect<void>;
}

/** A notice that shows on its first message and stays until its Scope closes. */
export interface ProgressNotice {
  setMessage(message: NoticeMessage): Effect.Effect<void>;
}

/** Shows ZotLit's notices. */
export class Notifier extends Context.Service<
  Notifier,
  {
    show(
      message: NoticeMessage,
      options?: NoticeOptions,
    ): Effect.Effect<NoticeHandle>;
    /** In place of `using LazyNotice`: the notice hides when the Scope closes. */
    readonly progress: Effect.Effect<ProgressNotice, never, Scope.Scope>;
  }
>()("zotlit/obsidian/Notifier") {}

/** Notices drawn by Obsidian, with ZotLit's `BaseNotice` styling. */
export const layerNotifier: Layer.Layer<Notifier> = Layer.succeed(
  Notifier,
  Notifier.of({
    show: Effect.fn("Notifier.show")((message, options) =>
      Effect.sync(() => {
        const notice = new BaseNotice(message, options?.duration);
        return {
          hide: Effect.sync(() => notice.hide()),
          setMessage: (next) => Effect.sync(() => void notice.setMessage(next)),
        };
      }),
    ),
    progress: Effect.map(
      Effect.acquireDisposable(Effect.sync(() => new LazyNotice())),
      (notice) => ({
        setMessage: (message) => Effect.sync(() => notice.setMessage(message)),
      }),
    ),
  }),
);

/** The three messages of a task's progress notice. */
export interface ProgressCopy {
  readonly loading: NoticeMessage;
  readonly success: NoticeMessage;
  /** The error message, or the message for the error the task failed with. */
  readonly error: NoticeMessage | ((error: unknown) => NoticeMessage);
  /**
   * How long the success message stays.
   *
   * @default "2 seconds"
   */
  readonly successDuration?: Duration.Input;
}

/**
 * Report a task's outcome the way `toast.promise` does: the loading message
 * after 200 ms when the task has not finished (so a fast task does not flash
 * it), then the success message for 2 s (or `successDuration`) or the error
 * message for 4 s. An interrupted task counts as a success, an abort shows
 * nothing, and an error is logged.
 *
 * @param outcome Completes with the task's Exit once the task ends. It runs
 *   again after the loading delay, so it awaits a task started elsewhere
 *   (`Fiber.await`, `Deferred.await`) rather than running the task.
 */
export const reportProgress = Effect.fn("Notifier.reportProgress")(function* <
  A,
  E,
>(outcome: Effect.Effect<Exit.Exit<A, E>>, copy: ProgressCopy) {
  const notifier = yield* Notifier;
  const notice = yield* notifier.progress;
  const early = yield* Effect.timeoutOption(outcome, "200 millis");
  if (Option.isNone(early)) yield* notice.setMessage(copy.loading);
  const exit = Option.isSome(early) ? early.value : yield* outcome;
  if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) {
    yield* notice.setMessage(copy.success);
    yield* Effect.sleep(copy.successDuration ?? "2 seconds");
    return;
  }
  const { error } = copy;
  const message = yield* failureMessage(
    exit.cause,
    typeof error === "function" ? error : () => error,
  );
  if (message === undefined) return;
  yield* notice.setMessage(message);
  yield* Effect.sleep("4 seconds");
}, Effect.scoped);

/**
 * The error message for a task that failed with `cause`: none for an abort,
 * else the message `copy` gives for the error, logged with the error.
 */
const failureMessage = Effect.fnUntraced(function* (
  cause: Cause.Cause<unknown>,
  copy: (error: unknown) => NoticeMessage | undefined,
) {
  const error = Cause.squash(cause);
  if (AbortError.test(error)) return undefined;
  const message = copy(error);
  yield* Effect.logError("Toast reported error").pipe(
    Effect.annotateLogs({
      message: typeof message === "string" ? message : message?.textContent,
      error,
    }),
    withLogCategory("toast"),
  );
  return message;
});

/** The messages of a task's outcome notice; see {@link reportOutcome}. */
export interface OutcomeCopy<A> {
  /** The success message for the result, or none. */
  readonly success: (result: A) => NoticeMessage | undefined;
  /** The error message for the error the task failed with, or none. */
  readonly error: (error: unknown) => NoticeMessage | undefined;
}

/**
 * Run `task` and report its outcome as {@link reportProgress} does, without a
 * loading message: the success message for 2 s, or the error message for 4 s
 * with the error logged. An abort shows nothing. The notice does not hold the
 * run, and an interrupt passes on without a notice.
 */
export const reportOutcome = Effect.fn("Notifier.reportOutcome")(function* <
  A,
  E,
  R,
>(task: Effect.Effect<A, E, R>, copy: OutcomeCopy<A>) {
  const notifier = yield* Notifier;
  const exit = yield* Effect.exit(task);
  if (Exit.isSuccess(exit)) {
    const message = copy.success(exit.value);
    if (message) yield* notifier.show(message, { duration: 2000 });
    return;
  }
  if (Cause.hasInterruptsOnly(exit.cause))
    return yield* Effect.failCause(exit.cause);
  const message = yield* failureMessage(exit.cause, copy.error);
  if (message) yield* notifier.show(message, { duration: 4000 });
});
