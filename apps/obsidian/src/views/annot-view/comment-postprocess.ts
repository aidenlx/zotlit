// Post-render fixups applied to a rendered Annotation Card comment.

/**
 * Reconcile `MarkdownRenderer` output with what an Annotation Card promises.
 *
 * Today that is tags only: the renderer auto-linkifies `#tag`, but a Zotero
 * comment's `#` is ordinary prose (real tags live in the card's tag chips), so
 * every tag anchor is unwrapped into its own text. Runs on the container after
 * rendering; call it again after any re-render.
 */
export function postProcessComment(container: HTMLElement): void {
  for (const anchor of container.querySelectorAll("a.tag")) {
    anchor.replaceWith(...anchor.childNodes);
  }
}
