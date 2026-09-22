// The gated crops the display's own Node harness and the Chromium refresh trial
// both drive: the harness, not a clock, decides when a crop answers, and one the
// service abandons before any answer is recorded as cancelled rather than
// answered. The service aborts the signal of its own finished job too, so only a
// render that was answered nothing counts as abandoned.
import type { ExcerptImage } from "@/services/excerpt-image/format";
import type { ExcerptRequest } from "@/services/excerpt-image/service";

/** One crop held open, with the ways a harness answers or abandons it. */
export interface GatedRender {
  readonly request: ExcerptRequest;
  readonly signal: AbortSignal;
  readonly answer: PromiseWithResolvers<ExcerptImage>;
  /** Resolves when the render was abandoned before any answer. */
  readonly cancelled: Promise<void>;
  /** Whether the harness has answered or failed the render. */
  answered: boolean;
  aborted: boolean;
}

/** Every crop of one harness, in the order the service reached it. */
export interface RenderGate {
  readonly renders: GatedRender[];
  /** A `this`-free function, so a harness can hand it straight to the service. */
  readonly render: (
    request: ExcerptRequest,
    signal: AbortSignal,
  ) => Promise<ExcerptImage>;
  /** The render at `index`, once it has started. */
  readonly started: (index: number) => Promise<GatedRender>;
}

export function renderGate(): RenderGate {
  const renders: GatedRender[] = [];
  let arrived = Promise.withResolvers<void>();
  return {
    renders,
    render: (request, signal) => {
      const answer = Promise.withResolvers<ExcerptImage>();
      const cancelled = Promise.withResolvers<void>();
      const render: GatedRender = {
        request,
        signal,
        answer,
        cancelled: cancelled.promise,
        answered: false,
        aborted: false,
      };
      renders.push(render);
      arrived.resolve();
      arrived = Promise.withResolvers<void>();
      signal.addEventListener(
        "abort",
        () => {
          if (render.answered) return;
          render.aborted = true;
          cancelled.resolve();
          answer.reject(signal.reason);
        },
        { once: true },
      );
      return answer.promise;
    },
    started: async (index) => {
      while (renders.length <= index) await arrived.promise;
      return renders[index]!;
    },
  };
}
