// An in-memory Notifier: records each notice in place of drawing it.
import { Effect, Layer } from "effect";
import { noticeFibers, Notifier } from "@/lib/notifier";
import type { NoticeMessage } from "@/lib/notifier";

export interface RecordedNotice {
  /** Every message the notice showed, the first one first. */
  readonly messages: NoticeMessage[];
  /** `0` for a progress notice, which stays until its Scope closes. */
  readonly duration: number | undefined;
  hidden: boolean;
}

/** A Notifier that records its notices, with the layer that provides it. */
export function testNotifier() {
  const notices: RecordedNotice[] = [];
  const record = (message: NoticeMessage, duration: number | undefined) => {
    const notice: RecordedNotice = {
      messages: [message],
      duration,
      hidden: false,
    };
    notices.push(notice);
    return notice;
  };
  const base: Omit<Notifier["Service"], "track"> = {
    show: (message, options) =>
      Effect.sync(() => {
        const notice = record(message, options?.duration);
        return {
          hide: Effect.sync(() => {
            notice.hidden = true;
          }),
          setMessage: (next) => Effect.sync(() => notice.messages.push(next)),
        };
      }),
    progress: Effect.acquireRelease(
      Effect.sync(() => {
        let notice: RecordedNotice | null = null;
        return {
          hide: () => {
            if (notice) notice.hidden = true;
          },
          setMessage: (message: NoticeMessage) =>
            Effect.sync(() => {
              if (notice) notice.messages.push(message);
              else notice = record(message, 0);
            }),
        };
      }),
      (progress) => Effect.sync(progress.hide),
    ).pipe(Effect.map(({ setMessage }) => ({ setMessage }))),
  };
  return {
    notices: notices as readonly RecordedNotice[],
    /** The notices without a layer Scope: a tracked notice needs `layer`. */
    service: Notifier.of({
      ...base,
      track: () =>
        Effect.die(new Error("A tracked notice needs testNotifier().layer")),
    }),
    /** The notices, with tracked notices on a FiberSet of the layer's Scope. */
    layer: Layer.effect(Notifier, noticeFibers(base)),
  };
}
