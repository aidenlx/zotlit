// The Effect side of ./reading-view: what a reading surface's layer asks of
// the open reading views through the Workspace tag.
import { Effect } from "effect";

import type { WorkspaceShape } from "./obsidian-workspace";
import { rerenderReadingViews } from "./reading-view";

/**
 * Renders every open reading view again, which is how a post-processor's
 * output catches up with a change to which text it touches.
 */
export const rerenderReadingViewsIn = Effect.fn("rerenderReadingViewsIn")(
  function* (workspace: Pick<WorkspaceShape, "markdownViews">) {
    const count = rerenderReadingViews(yield* workspace.markdownViews);
    yield* Effect.logDebug("Rerendering reading views").pipe(
      Effect.annotateLogs({ count }),
    );
  },
);

/**
 * When the current Scope closes, retires the surface and renders the reading
 * views again, so they drop what the surface wrote. `retire` goes first: the
 * post-processor stays registered while the views render again.
 */
export const retireReadingSurface = (
  workspace: Pick<WorkspaceShape, "markdownViews">,
  retire: () => void,
) =>
  Effect.addFinalizer(() =>
    Effect.suspend(() => {
      retire();
      return rerenderReadingViewsIn(workspace);
    }),
  );
