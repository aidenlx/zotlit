// The fan-out the reading-mode surfaces share. A reading view holds what a
// Markdown post-processor produced, so a service whose data changed outside the
// document has to ask the views to render that Markdown again.

import { MarkdownView } from "obsidian";
import type { App, MarkdownPostProcessorContext } from "obsidian";

/** The document offsets one rendered reading-view section covers. */
export interface SectionRange {
  from: number;
  /** One past the last offset, so the whole of the section's last line is in. */
  to: number;
}

/**
 * Where in its document one rendered section sits, which is what lets a
 * post-processor tell the Citation Occurrences it shows from the identical ones
 * written elsewhere in the same document.
 *
 * @param el one rendered section, as a Markdown post-processor receives it.
 * @returns null when Obsidian places the section in no source range — an embed
 *   and a popover render outside one — which leaves the surface no coordinate.
 */
export function sectionRange(
  ctx: MarkdownPostProcessorContext,
  el: HTMLElement,
): SectionRange | null {
  const info = ctx.getSectionInfo(el);
  if (info === null) return null;
  return {
    from: lineStart(info.text, info.lineStart),
    to: lineStart(info.text, info.lineEnd + 1),
  };
}

/**
 * @returns the offset line `line` starts at, or the end of `text` when it
 *   writes fewer lines than that.
 */
function lineStart(text: string, line: number): number {
  let offset = 0;
  for (let index = 0; index < line; index += 1) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return offset;
}

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
