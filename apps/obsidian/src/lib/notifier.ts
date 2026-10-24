// Obsidian notices as a service the Effect layers show their toasts through.
import { AbortError } from "@/lib/abort-error";
import { Cause, Context, Effect, Exit, Layer, Option } from "@/lib/effect";
import type { Scope } from "@/lib/effect";
import { withLogCategory } from "@/lib/effect-log";
import { acquireDisposable } from "@/lib/effect-scope";
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
    show: (message, options) =>
      Effect.sync(() => {
        const notice = new BaseNotice(message, options?.duration);
        return {
          hide: Effect.sync(() => notice.hide()),
          setMessage: (next) => Effect.sync(() => void notice.setMessage(next)),
        };
      }),
    progress: Effect.map(
      acquireDisposable(() => new LazyNotice()),
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
  readonly error: NoticeMessage;
}

/**
 * Report a task's outcome the way `toast.promise` does: the loading message
 * after 200 ms when the task has not finished (so a fast task does not flash
 * it), then the success message for 2 s or the error message for 4 s. An
 * interrupted task counts as a success, an abort shows nothing, and an error
 * is logged.
 *
 * @param outcome Completes with the task's Exit once the task ends.
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
    yield* Effect.sleep("2 seconds");
    return;
  }
  const error = Cause.squash(exit.cause);
  if (AbortError.test(error)) return;
  yield* Effect.logError("Toast reported error").pipe(
    Effect.annotateLogs({
      message:
        typeof copy.error === "string" ? copy.error : copy.error.textContent,
      error,
    }),
    withLogCategory("toast"),
  );
  yield* notice.setMessage(copy.error);
  yield* Effect.sleep("4 seconds");
}, Effect.scoped);
