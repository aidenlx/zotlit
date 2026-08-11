import { MarkdownView } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";

import type { CitationOccurrence } from "@/services/citation-index/service";

/**
 * Scroll one citation into view and flash it in an open Markdown document.
 * `setEphemeralState` is the same path search results and the core Outline
 * plugin take; the method is public but the state fields are not (read from
 * the Obsidian 1.13 runtime). One object serves both modes: editing mode reads
 * `startLoc`/`endLoc` and flashes the exact range as an `is-flashing` CM6
 * decoration that stays until Escape, a click, or the next flash; reading view
 * reads only `line` and flashes the enclosing block for 3 s. `endLoc` must
 * accompany `startLoc` (`null` means to end of document), and `match` must stay
 * out when `line` is set — reading view would queue two scrolls. A document no
 * editor holds open has nothing to reveal.
 */
export function revealMarkdownOccurrence(options: {
  app: App;
  sourcePath: string;
  occurrence: CitationOccurrence;
  preferredLeaf?: WorkspaceLeaf | null;
}): void {
  const { app, sourcePath, occurrence, preferredLeaf } = options;
  const leaf =
    (preferredLeaf && markdownLeafAtPath(preferredLeaf, sourcePath)
      ? preferredLeaf
      : null) ||
    app.workspace
      .getLeavesOfType("markdown")
      .find((candidate) => markdownLeafAtPath(candidate, sourcePath));
  if (!leaf || !(leaf.view instanceof MarkdownView)) return;

  const { start, end } = occurrence.position;
  app.workspace.setActiveLeaf(leaf, { focus: true });
  leaf.view.setEphemeralState({
    startLoc: start,
    endLoc: end,
    line: start.line,
  });
}

function markdownLeafAtPath(leaf: WorkspaceLeaf, sourcePath: string): boolean {
  return (
    leaf.view instanceof MarkdownView && leaf.view.file?.path === sourcePath
  );
}
