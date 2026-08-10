// The fan-out the reading-mode surfaces share. A reading view holds what a
// Markdown post-processor produced, so a service whose data changed outside the
// document has to ask the views to render that Markdown again.

import { MarkdownView } from "obsidian";
import type { App } from "obsidian";

/**
 * Renders every open reading view again, which is how a post-processor's output
 * catches up with a setting or a data change.
 *
 * @returns how many views rendered again.
 */
export function rerenderReadingViews(app: App): number {
  let rendered = 0;
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const { view } = leaf;
    if (!(view instanceof MarkdownView)) continue;
    view.previewMode.rerender(true);
    rendered += 1;
  }
  return rendered;
}
