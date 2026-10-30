import type { MarkdownView } from "obsidian";

import type { CitationOccurrence } from "@/services/citation-index/service";

/**
 * Scroll `occurrence` into view in `view` and flash it.
 * `setEphemeralState` is the same path search results and the core Outline
 * plugin take; the method is public but the state fields are not (read from
 * the Obsidian 1.13 runtime). One object serves both modes: editing mode reads
 * `startLoc`/`endLoc` and flashes the exact range as an `is-flashing` CM6
 * decoration that stays until Escape, a click, or the next flash; reading view
 * reads only `line` and flashes the enclosing block for 3 s. `endLoc` must
 * accompany `startLoc` (`null` means to end of document), and `match` must stay
 * out when `line` is set — reading view would queue two scrolls.
 */
export function flashOccurrence(
  view: MarkdownView,
  occurrence: CitationOccurrence,
): void {
  const { start, end } = occurrence.position;
  view.setEphemeralState({
    startLoc: start,
    endLoc: end,
    line: start.line,
  });
}
