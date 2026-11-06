// What a preview surface shows while its render is pending: one rule for the
// Preview and the examples on the Properties and Name tabs, which keep only
// their own wording and layout.

import type { TemplateRenderResult } from "#/render/index";

import type { RenderSchedulerState } from "./scheduler-atoms";

/**
 * Why a surface is not showing a current result:
 * - `rendering`: a render is on its way and nothing stands yet;
 * - `behind`: the result stands until the reader runs the preview;
 * - `held`: the result stands while something outside the draft stops the
 *   render, which Run cannot help;
 * - `failed`: the draft does not parse, so the last good output stands, or
 *   nothing does.
 */
export type PendingNotice = "rendering" | "behind" | "held" | "failed";

export interface PendingView<R extends TemplateRenderResult> {
  /** The output the surface paints, or null for none. */
  readonly shown: R | null;
  /** Whether `shown` is the last good output rather than the latest result. */
  readonly retained: boolean;
  readonly notice: PendingNotice | null;
}

/**
 * What a surface shows from `state`.
 * @param produced Whether a result holds this surface's own output; the last
 * good output stands only where it does.
 */
export function pendingView<R extends TemplateRenderResult>(
  state: Pick<RenderSchedulerState<R>, "staleReason" | "result" | "retained">,
  produced: (result: R) => boolean,
): PendingView<R> {
  const { staleReason, result, retained } = state;
  const latest = (notice: PendingNotice | null): PendingView<R> => ({
    shown: result,
    retained: false,
    notice,
  });
  switch (staleReason) {
    case null:
      return latest(null);
    case "live":
      return latest(result === null ? "rendering" : null);
    case "demand":
      return latest("behind");
    case "hold":
      // With nothing to show, there is no last preview to name.
      return latest(result === null ? null : "held");
    case "invalid": {
      const kept = retained !== null && produced(retained) ? retained : null;
      return { shown: kept, retained: kept !== null, notice: "failed" };
    }
  }
}
