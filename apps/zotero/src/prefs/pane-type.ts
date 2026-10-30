// Reads the configured Obsidian pane placement for the links this add-on opens.
import type { PaneType } from "@zotlit/protocol";

import { prefs } from "./index";

/**
 * The stored value for "replace the active tab". `prefs.js` takes a literal
 * default, so absence is spelled rather than left blank — and it maps back to
 * an omitted `paneType` on the wire.
 */
const ACTIVE_TAB = "active";

const PANE_TYPES = new Set<string>(["tab", "split", "window"]);

/**
 * The pane a `zotlit/*` link should name, from the user's preference.
 *
 * @returns `undefined` for the active tab and for any unrecognized stored
 *   value, so a hand-edited pref degrades to Obsidian's default placement
 *   instead of breaking the link.
 */
export function preferredPaneType(): PaneType | undefined {
  const stored = prefs.get<string>("extensions.zotlit.pane-type");
  if (typeof stored !== "string" || stored === ACTIVE_TAB) return undefined;
  return PANE_TYPES.has(stored) ? (stored as PaneType) : undefined;
}
