// The fan-out the reading-mode surfaces share. A reading view holds what a
// Markdown post-processor produced. A surface rewrites what it placed there for
// as long as the section stays on screen, and asks the views to render that
// Markdown again only when structure changes: which links it touches at all,
// or whether it touches them.

import { MarkdownRenderChild, MarkdownView } from "obsidian";
import type { App, MarkdownPostProcessorContext } from "obsidian";

import { getLogger } from "@/lib/log";

const logger = getLogger("reading-view");

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
 * @param ctx the post-processor context that section was rendered under.
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

/** One held section: the document it shows, and the rewrite that refreshes it. */
interface LiveSection {
  path: string;
  show: () => void;
}

/**
 * The sections a reading surface rendered into and Obsidian still shows.
 *
 * Holding a section hangs a render child on its post-processor context, which
 * Obsidian unloads with the section — on a view close, a re-render, an embed
 * torn down — and that unload drops the section here. Holding a section already
 * held replaces its rewrite and keeps the child.
 */
export class LiveSections {
  readonly #sections = new Map<HTMLElement, LiveSection>();

  /**
   * @param el the rendered section.
   * @param ctx the post-processor context the section was rendered under.
   * @param show rewrites what the surface placed in `el` from current data.
   */
  hold(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    show: () => void,
  ): void {
    const held = this.#sections.get(el);
    if (held !== undefined) {
      held.show = show;
      return;
    }
    this.#sections.set(el, { path: ctx.sourcePath, show });
    const child = new MarkdownRenderChild(el);
    child.onunload = () => {
      this.#sections.delete(el);
    };
    ctx.addChild(child);
  }

  /** Rewrites the live sections of one document, or every live section. */
  refresh(path?: string): void {
    let count = 0;
    for (const section of this.#sections.values()) {
      if (path !== undefined && section.path !== path) continue;
      section.show();
      count += 1;
    }
    logger.trace("Refreshed live sections", { path, count });
  }
}
