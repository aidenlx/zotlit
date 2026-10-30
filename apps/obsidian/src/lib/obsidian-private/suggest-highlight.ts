// The highlight of Obsidian's suggestion popover, which its public API leaves
// on the first item each time the list shows. Obsidian's own property value
// and tag suggests take it off while nothing is typed (verified against
// Obsidian 1.14.4), so Enter takes no value the user never chose. A build
// without the private chooser cannot take it off, so a caller opens no
// popover before a key is typed there.
//
// @see apps/obsidian/docs/adr/0068-query-files-are-a-zotlit-file-type-embedded-through-the-private-embed-registry.md
import type { PopoverSuggest } from "obsidian";

import { getLogger } from "@/lib/log";

const logger = getLogger(["obsidian-private", "suggest-highlight"]);

let warned = false;

/** The private chooser of `suggest`, where this build gives it one. */
function chooser(suggest: PopoverSuggest<unknown>) {
  const { suggestions } = suggest;
  if (typeof suggestions?.forceSetSelectedItem === "function")
    return (at: number) => suggestions.forceSetSelectedItem?.(at, null);
  if (!warned) {
    warned = true;
    logger.warn(
      "Obsidian's suggestion popover has no chooser to clear; suggestions open only once a key is typed",
    );
  }
  return null;
}

/** Whether {@link clearSuggestHighlight} can take the highlight off `suggest`. */
export function canClearSuggestHighlight(
  suggest: PopoverSuggest<unknown>,
): boolean {
  return chooser(suggest) !== null;
}

/** Highlight no item of `suggest`'s list, where this build can. */
export function clearSuggestHighlight(suggest: PopoverSuggest<unknown>): void {
  chooser(suggest)?.(-1);
}
