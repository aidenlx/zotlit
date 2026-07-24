// Markdown rendering for an Annotation Card comment.
//
// A comment is stored as Zotero HTML, yet it reaches the card as HTML→Markdown→
// DOM rather than rendering that HTML directly. The extra hop is the point: it
// runs through the same `commentToMarkdown` seam the `annotation` template uses,
// so the card previews exactly the text a Literature Note will contain and a
// `**bold**` typed in Zotero reads the same in both places.

import {
  Keymap,
  MarkdownRenderChild,
  MarkdownRenderer,
  type App,
  type Component,
} from "obsidian";

import { getLogger } from "@/lib/log";
import {
  commentToMarkdown,
  createCommentTurndown,
} from "@/lib/turndown/comment";

import { postProcessComment } from "./comment-postprocess";

const logger = getLogger(["views", "annot-view"]);

export interface CommentRenderDeps {
  app: App;
  /** Owns the rendered children; unloading it tears every comment down. */
  component: Component;
  /**
   * Literature Note the comment's links resolve against, `""` for vault root.
   * Read at render and again at click time, so a note created after the card
   * rendered still anchors its links.
   */
  getSourcePath: () => string;
}

/** Renders `html` into `el`; the returned callback disposes that render. */
export type CommentRenderer = (el: HTMLElement, html: string) => () => void;

/** One Turndown instance is shared across every comment the view renders. */
export function createCommentRenderer(
  deps: CommentRenderDeps,
): CommentRenderer {
  let turndown: ReturnType<typeof createCommentTurndown> | null = null;

  return (el, html) => {
    turndown ??= createCommentTurndown(TurndownService);
    const markdown = commentToMarkdown(turndown, html);
    let disposed = false;

    el.empty();
    const child = deps.component.addChild(new MarkdownRenderChild(el));
    child.registerDomEvent(el, "click", (evt) =>
      openInternalLink(deps.app, deps.getSourcePath(), evt),
    );
    MarkdownRenderer.render(deps.app, markdown, el, deps.getSourcePath(), child)
      // A render superseded mid-flight has already had its output cleared, so
      // its fixups would land on the replacement's DOM.
      .then(() => {
        if (!disposed) postProcessComment(el);
      })
      .catch((error: unknown) => {
        logger.warn("Failed to render annotation comment", { error });
      });

    return () => {
      disposed = true;
      deps.component.removeChild(child);
    };
  };
}

/**
 * Route clicks on rendered internal links through the workspace so they open in
 * the vault with the usual modifier-key panes. External links keep the default
 * anchor behavior.
 */
function openInternalLink(app: App, sourcePath: string, evt: MouseEvent): void {
  if (!(evt.target instanceof HTMLElement)) return;
  const anchor = evt.target.closest("a.internal-link");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  const href = anchor.dataset.href ?? anchor.getAttribute("href");
  if (!href) return;
  evt.preventDefault();
  void app.workspace.openLinkText(href, sourcePath, Keymap.isModEvent(evt));
}
