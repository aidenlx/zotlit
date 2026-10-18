// The highlight of Obsidian's suggestion popover, which its public API leaves
// on the first item each time the list shows. Obsidian's own property value
// and tag suggests take it off while nothing is typed (verified against
// Obsidian 1.14.4), so Enter takes no value the user never chose. A build
// without the private chooser keeps the highlight; the popover still works.
import type { PopoverSuggest } from "obsidian";

import { getLogger } from "@/lib/log";

const logger = getLogger(["obsidian-private", "suggest-highlight"]);

let warned = false;

interface Chooser {
  forceSetSelectedItem?: (at: number, event: Event | null) => void;
}

/** Highlight no item of `suggest`'s list. */
export function clearSuggestHighlight(suggest: PopoverSuggest<unknown>): void {
  const chooser = (suggest as unknown as { suggestions?: Chooser }).suggestions;
  if (typeof chooser?.forceSetSelectedItem === "function") {
    chooser.forceSetSelectedItem(-1, null);
    return;
  }
  if (warned) return;
  warned = true;
  logger.warn(
    "Obsidian's suggestion popover has no chooser to clear; its first item stays highlighted",
  );
}
